/**
 * MCP PR Reviewer
 * 
 * Intelligent PR reviews powered by the Model Context Protocol and LLMs
 */

const path = require('path');
const fetch = require('node-fetch');
const { spawn } = require('child_process');

// Path to the scripts directory
const SCRIPTS_DIR = path.join(__dirname, '.github', 'scripts');

/**
 * Start the MCP GitHub server
 * @param {Object} options - Server options
 * @param {number} options.port - Port to run the server on (default: 8080)
 * @returns {ChildProcess} The server process
 */
function startMCPGitHubServer(options = {}) {
  const port = options.port || 8080;
  process.env.MCP_GITHUB_PORT = port;
  
  const server = spawn('npx', ['@modelcontextprotocol/server-github'], {
    stdio: 'pipe',
    shell: true,
    env: process.env
  });
  
  return server;
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
  
  const server = spawn('node', [path.join(SCRIPTS_DIR, 'mcp-llm-provider.js')], {
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
    path.join(SCRIPTS_DIR, 'analyze-pr.js'),
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
  startMCPGitHubServer,
  startLLMProvider,
  analyzePR,
  
  // Export the CLI entry point for programmatic usage
  cli: require('./bin/cli')
}; 