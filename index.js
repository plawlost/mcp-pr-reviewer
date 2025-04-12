/**
 * MCP PR Reviewer
 * 
 * Intelligent PR reviews powered by the Model Context Protocol and LLMs
 */

const path = require('path');
const fetch = require('node-fetch');
const { spawn } = require('child_process');
// const MCP = require('@modelcontextprotocol/server-github'); // No longer required here for the default export
const chalk = require('chalk');

// Path to the library directory
const LIB_DIR = path.join(__dirname, 'lib');

/**
 * Start the MCP GitHub server as a separate process using npx.
 * This is suitable for the CLI `analyze` command where npx handles the dependency.
 * @param {Object} options - Server options
 * @param {number} options.port - Port to run the server on (default: 8080)
 * @returns {ChildProcess} The spawned server process
 */
function startMCPGitHubServerProcess(options = {}) {
  const port = options.port || 8080;
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;

  if (!token) {
    throw new Error('GITHUB_TOKEN (or GITHUB_PERSONAL_ACCESS_TOKEN) environment variable is required to start the MCP GitHub Server process');
  }

  console.log(chalk.blue(`Spawning MCP GitHub server via npx on port ${port}...`));
  
  // Pass the token and port via environment variables to the npx process
  const serverProcess = spawn('npx', ['@modelcontextprotocol/server-github'], {
    stdio: 'pipe', // Use pipe to capture output if needed, or 'inherit' to show directly
    shell: true, // May be needed for npx depending on the environment
    env: {
      ...process.env, // Inherit parent environment
      GITHUB_PERSONAL_ACCESS_TOKEN: token, // Explicitly pass the token
      MCP_SERVER_PORT: port.toString() // Pass the port (server-github might look for this)
    }
  });

  // Set the port in the current process's env for the analyzer script to use
  process.env.MCP_GITHUB_PORT = port.toString();

  console.log(chalk.dim(`MCP GitHub server process spawned with PID: ${serverProcess.pid}`));
  
  return serverProcess;
}

/**
 * Start the LLM provider server
 * @param {Object} options - Server options
 * @param {number} options.port - Port to run the server on (default: 8090)
 * @param {string} options.model - LLM model to use
 * @returns {ChildProcess} The server process
 */
function startLLMProvider(options = {}) {
  const port = options.port || 8090;
  process.env.LLM_PROVIDER_PORT = port;
  
  if (options.model) {
    process.env.LLM_MODEL = options.model;
  }
  
  const server = spawn('node', [path.join(LIB_DIR, 'mcp-llm-provider.js')], {
    stdio: 'pipe',
    shell: true,
    env: process.env
  });
  
  return server;
}

/**
 * Analyze a PR
 * @param {Object} options - Analysis options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number|string} options.prNumber - Pull Request number
 * @returns {Promise<string>} The analysis result
 */
async function analyzePR(options) {
  if (!options.owner || !options.repo || !options.prNumber) {
    throw new Error('Missing required parameters: owner, repo, and prNumber are required');
  }
  
  const analyzer = spawn('node', [
    path.join(LIB_DIR, 'analyze-pr.js'),
    options.owner,
    options.repo,
    options.prNumber
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });
  
  return new Promise((resolve, reject) => {
    let output = '';
    
    analyzer.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    analyzer.stderr.on('data', (data) => {
      console.error(`Error: ${data.toString()}`);
    });
    
    analyzer.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Analysis failed with code ${code}`));
      } else {
        resolve(output);
      }
    });
  });
}

// Export the API
module.exports = {
  startMCPGitHubServerProcess, // Export the process spawner
  startLLMProvider,
  analyzePR,
  
  // Export the CLI entry point for programmatic usage
  cli: require('./bin/cli')
}; 