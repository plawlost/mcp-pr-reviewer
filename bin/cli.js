#!/usr/bin/env node

const { spawn } = require('child_process');
const path = require('path');
const { program } = require('commander');
const chalk = require('chalk');
const packageJson = require('../package.json');

// Define the path to the scripts directory
const SCRIPTS_DIR = path.join(__dirname, '..', '.github', 'scripts');

// Set up the CLI program
program
  .name('mcp-pr-reviewer')
  .description('Intelligent PR reviews powered by Model Context Protocol and LLMs')
  .version(packageJson.version);

// Analyze command
program
  .command('analyze')
  .description('Analyze a specific PR')
  .argument('<owner>', 'Repository owner')
  .argument('<repo>', 'Repository name')
  .argument('<pr-number>', 'Pull Request number')
  .option('-m, --model <model>', 'Specify LLM model to use (default: openrouter/optimus-alpha)')
  .option('--mcp-port <port>', 'MCP GitHub server port (default: 8080)')
  .option('--llm-port <port>', 'LLM provider port (default: 8090)')
  .action(async (owner, repo, prNumber, options) => {
    try {
      // Set environment variables from options
      if (options.model) process.env.LLM_MODEL = options.model;
      if (options.mcpPort) process.env.MCP_GITHUB_PORT = options.mcpPort;
      if (options.llmPort) process.env.LLM_PROVIDER_PORT = options.llmPort;

      // Verify OpenRouter API key is present
      if (!process.env.OPENROUTER_API_KEY) {
        console.error(chalk.red('Error: OPENROUTER_API_KEY environment variable is required'));
        process.exit(1);
      }

      // Verify GitHub token is present
      if (!process.env.GITHUB_TOKEN && !process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
        console.warn(chalk.yellow('Warning: GITHUB_TOKEN or GITHUB_PERSONAL_ACCESS_TOKEN environment variable is not set'));
        console.warn(chalk.yellow('This may limit access to private repositories'));
      }

      console.log(chalk.blue('Starting LLM provider...'));
      
      // Start LLM provider
      const llmProvider = spawn('node', [path.join(SCRIPTS_DIR, 'mcp-llm-provider.js')], {
        stdio: 'pipe',
        shell: true,
        env: process.env
      });
      
      // Handle provider output
      llmProvider.stdout.on('data', (data) => {
        console.log(chalk.dim(`[LLM Provider] ${data.toString().trim()}`));
      });
      
      llmProvider.stderr.on('data', (data) => {
        console.error(chalk.red(`[LLM Provider] ${data.toString().trim()}`));
      });
      
      // Wait a moment for provider to start
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      console.log(chalk.green(`Analyzing PR #${prNumber} in ${owner}/${repo}...`));
      
      // Run analysis
      const analyzer = spawn('node', [
        path.join(SCRIPTS_DIR, 'analyze-pr.js'),
        owner,
        repo,
        prNumber
      ], {
        stdio: 'inherit',
        env: process.env
      });
      
      // Wait for analysis to complete
      analyzer.on('close', (code) => {
        // Cleanup - Only need to kill LLM provider now
        llmProvider.kill();
        
        if (code !== 0) {
          console.error(chalk.red(`Analysis failed with code ${code}`));
          process.exit(code);
        }
        
        console.log(chalk.green('Analysis completed successfully'));
      });
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  });

// Server command - Starts the PR Reviewer LLM Analyzer MCP server
program
  .command('server')
  .description('Start the PR Reviewer LLM Analyzer MCP server')
  .option('-p, --port <port>', 'Port to run the MCP server on (default: 8090)')
  .option('-m, --model <model>', 'Specify LLM model to use (default: openrouter/optimus-alpha)')
  .action((options) => {
    try {
      // Set environment variables from options
      if (options.port) process.env.LLM_PROVIDER_PORT = options.port;
      if (options.model) process.env.LLM_MODEL = options.model;
      
      // Verify OpenRouter API key is present
      if (!process.env.OPENROUTER_API_KEY) {
        console.error(chalk.red('Error: OPENROUTER_API_KEY environment variable is required for the server.'));
        process.exit(1);
      }
      
      const serverPort = process.env.LLM_PROVIDER_PORT || 8090;
      console.log(chalk.blue(`Starting PR Reviewer LLM Analyzer MCP server on port ${serverPort}...`));
      
      // Start the refactored MCP server script
      const mcpServerProcess = spawn('node', [path.join(SCRIPTS_DIR, 'mcp-llm-provider.js')], {
        stdio: 'inherit', // Show server logs directly
        env: process.env
      });
      
      // Handle termination
      mcpServerProcess.on('close', (code) => {
         console.log(`MCP Server process exited with code ${code}`);
         process.exit(code || 0);
      });
      mcpServerProcess.on('error', (err) => {
        console.error(chalk.red(`Failed to start MCP server: ${err.message}`));
        process.exit(1);
      });

      // Graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nGracefully shutting down MCP server...');
        mcpServerProcess.kill('SIGINT'); 
      });
      process.on('SIGTERM', () => {
        console.log('Gracefully shutting down MCP server...');
        mcpServerProcess.kill('SIGTERM');
      });

    } catch (error) {
      console.error(chalk.red(`Error starting server: ${error.message}`));
      process.exit(1);
    }
  });

// Default command
program
  .action(() => {
    if (process.argv.length === 2) {
      // No commands provided, show help
      program.help();
    }
  });

// Parse command line arguments
program.parse(process.argv); 