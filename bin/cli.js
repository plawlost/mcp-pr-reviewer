#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const { program } = require('commander');
const chalk = require('chalk');
const packageJson = require('../package.json');
// Import the main module functions
const { startMCPGitHubServerProcess, startLLMProvider } = require('../index.js'); 

// Define the path to the library directory
const LIB_DIR = path.join(__dirname, '..', 'lib');

// Helper function for graceful shutdown
const cleanupProcesses = (processes) => {
  console.log(chalk.blue('\nShutting down services...'));
  processes.forEach(p => {
    if (p) {
      if (p.kill) { // ChildProcess
        console.log(chalk.dim(`Sending SIGTERM to process ${p.pid}...`));
        p.kill('SIGTERM');
      } else if (p.close) { // MCP Server instance - This case might no longer be needed if analyze always spawns
        // console.log(chalk.dim('Closing MCP GitHub server...'));
        // p.close().catch(err => console.error(chalk.red('Error closing MCP server:'), err));
      }
    }
  });
};

// Set up the CLI program
program
  .name('mcp-pr-reviewer')
  .description('Intelligent PR reviews powered by Model Context Protocol and LLMs')
  .version(packageJson.version);

// Analyze command
program
  .command('analyze')
  .description('Analyze a specific PR using MCP GitHub Server and LLM Provider')
  .argument('<owner>', 'Repository owner')
  .argument('<repo>', 'Repository name')
  .argument('<pr-number>', 'Pull Request number')
  .option('-m, --model <model>', 'Specify LLM model to use (default: openrouter/optimus-alpha)')
  .option('--mcp-port <port>', 'MCP GitHub server port (default: 8080)', '8080')
  .option('--llm-port <port>', 'LLM provider port (default: 8090)', '8090')
  .action(async (owner, repo, prNumber, options) => {
    let mcpServerProcess = null;
    let llmProviderProcess = null;
    const processesToClean = [];

    // Register cleanup handler
    process.on('SIGINT', () => cleanupProcesses(processesToClean));
    process.on('SIGTERM', () => cleanupProcesses(processesToClean));

    try {
      // Set environment variables from options *before* starting servers
      process.env.LLM_MODEL = options.model || process.env.LLM_MODEL || 'openrouter/optimus-alpha';
      process.env.MCP_GITHUB_PORT = options.mcpPort;
      process.env.LLM_PROVIDER_PORT = options.llmPort;

      // --- Validate Required Environment Variables ---
      if (!process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY environment variable is required');
      }
      if (!process.env.GITHUB_TOKEN) {
         // Use GITHUB_PERSONAL_ACCESS_TOKEN as fallback if needed
         if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
            process.env.GITHUB_TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
         } else {
            throw new Error('GITHUB_TOKEN (or GITHUB_PERSONAL_ACCESS_TOKEN) environment variable is required');
         }
      }

      // --- Start MCP GitHub Server ---
      try {
        console.log(chalk.blue(`Attempting to start MCP GitHub server on port ${options.mcpPort}...`));
        mcpServerProcess = startMCPGitHubServerProcess({ port: parseInt(options.mcpPort) });
        processesToClean.push(mcpServerProcess); // Add ChildProcess for cleanup
        
        // Handle MCP server output/errors for better diagnostics
        mcpServerProcess.stdout.on('data', (data) => console.log(chalk.dim(`[MCP Server] ${data.toString().trim()}`)));
        mcpServerProcess.stderr.on('data', (data) => {
            const stderrStr = data.toString().trim();
            // Filter out expected startup messages if necessary
            if (stderrStr && !stderrStr.includes('GitHub MCP Server running')) {
                console.error(chalk.red(`[MCP Server ERR] ${stderrStr}`));
            }
        });
        mcpServerProcess.on('error', (err) => {
            console.error(chalk.red(`MCP Server process error: ${err.message}`));
            cleanupProcesses(processesToClean);
            process.exit(1);
        });

        // Need to wait a bit for the spawned server to be ready
        await new Promise(resolve => setTimeout(resolve, 3000)); // Increased wait time

        console.log(chalk.green('MCP GitHub server process started.'));
      } catch (error) {
        throw new Error(`Failed to start MCP GitHub server process: ${error.message}`);
      }
      
      // --- Start LLM Provider Server ---
      try {
        console.log(chalk.blue(`Starting LLM provider on port ${options.llmPort}...`));
        // Use the imported startLLMProvider function which returns a ChildProcess
        llmProviderProcess = startLLMProvider({ 
            port: parseInt(options.llmPort), 
            model: process.env.LLM_MODEL 
        });
        processesToClean.push(llmProviderProcess); // Add for cleanup

        // Basic output handling for LLM Provider
        llmProviderProcess.stdout.on('data', (data) => console.log(chalk.dim(`[LLM Provider] ${data.toString().trim()}`)));
        llmProviderProcess.stderr.on('data', (data) => console.error(chalk.red(`[LLM Provider ERR] ${data.toString().trim()}`)));
        llmProviderProcess.on('error', (err) => {
            console.error(chalk.red(`LLM Provider process error: ${err.message}`));
            // Trigger cleanup if provider fails to start properly
            cleanupProcesses(processesToClean); 
            process.exit(1);
        });
        
        // Optional: Add a small delay or readiness check for the LLM provider if needed
        await new Promise(resolve => setTimeout(resolve, 2000)); 
        console.log(chalk.green('LLM Provider started.'));

      } catch (error) {
         throw new Error(`Failed to start LLM Provider: ${error.message}`);
      }

      // --- Run Analysis Script ---
      console.log(chalk.cyan(`\nRunning analysis for PR #${prNumber} in ${owner}/${repo}...`));
      
      const analyzer = spawn('node', [
        path.join(LIB_DIR, 'analyze-pr.js'),
        owner,
        repo,
        prNumber.toString() // Ensure it's a string
      ], {
        stdio: 'inherit', // Show analysis logs directly
        env: { // Pass necessary env vars
            ...process.env, 
            MCP_GITHUB_PORT: options.mcpPort, // Ensure analyzer knows where MCP server is
            LLM_PROVIDER_PORT: options.llmPort // Ensure analyzer knows where LLM provider is
        } 
      });

      // Wait for analysis to complete
      await new Promise((resolve, reject) => {
        analyzer.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`Analysis script failed with exit code ${code}`));
          } else {
            console.log(chalk.green('\nAnalysis completed successfully.'));
            resolve();
          }
        });
        analyzer.on('error', (err) => {
            reject(new Error(`Failed to run analysis script: ${err.message}`));
        });
      });

    } catch (error) {
      console.error(chalk.red(`\nError during analysis process: ${error.message}`));
      if (error.stack) {
          console.error(chalk.dim(error.stack));
      }
      process.exitCode = 1; // Set exit code to indicate failure
    } finally {
      // Ensure cleanup runs regardless of success or failure
      cleanupProcesses(processesToClean);
    }
  });

// Server command - Starts ONLY the LLM provider server
program
  .command('server')
  .description('Start the PR Reviewer LLM Provider server (for integrations like GitHub Actions)')
  .option('-p, --port <port>', 'Port to run the LLM provider on (default: 8090)', '8090')
  .option('-m, --model <model>', 'Specify LLM model to use (default: openrouter/optimus-alpha)')
  .action((options) => {
    let llmProviderProcess = null;
    const processesToClean = [];

     // Register cleanup handler
    process.on('SIGINT', () => cleanupProcesses(processesToClean));
    process.on('SIGTERM', () => cleanupProcesses(processesToClean));

    try {
      // Set environment variables
      process.env.LLM_PROVIDER_PORT = options.port;
      process.env.LLM_MODEL = options.model || process.env.LLM_MODEL || 'openrouter/optimus-alpha';

      // Verify OpenRouter API key
      if (!process.env.OPENROUTER_API_KEY) {
        throw new Error('OPENROUTER_API_KEY environment variable is required for the server.');
      }

      const serverPort = process.env.LLM_PROVIDER_PORT;
      console.log(chalk.blue(`Starting PR Reviewer LLM Provider server on port ${serverPort}...`));

      // Start the LLM provider script directly
      llmProviderProcess = spawn('node', [path.join(LIB_DIR, 'mcp-llm-provider.js')], {
        stdio: 'inherit', // Show server logs directly
        env: process.env
      });
      processesToClean.push(llmProviderProcess); // Add for cleanup

      llmProviderProcess.on('close', (code) => {
         console.log(`LLM Provider server process exited with code ${code}`);
         process.exit(code || 0);
      });
      llmProviderProcess.on('error', (err) => {
        console.error(chalk.red(`Failed to start LLM Provider server: ${err.message}`));
        process.exit(1);
      });

      console.log(chalk.green(`LLM Provider server running. Press Ctrl+C to stop.`));

    } catch (error) {
      console.error(chalk.red(`Error starting server: ${error.message}`));
      process.exit(1);
    }
  });

// Default command handler
program
  .action(() => {
    if (process.argv.length === 2) { // Show help if no command is given
      program.help();
    }
    // If arguments were given but didn't match a command, Commander handles the error.
  });

// Parse arguments
program.parse(process.argv); 