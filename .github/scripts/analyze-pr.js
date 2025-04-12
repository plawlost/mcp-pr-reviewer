// .github/scripts/analyze-pr.js
const fetch = require('node-fetch');
const { spawn } = require('child_process');

/**
 * Executes a command on the GitHub MCP server via STDIO.
 * 
 * @param {string} commandName - The name of the MCP command (e.g., "get_diff_pr").
 * @param {object} args - The arguments for the command.
 * @returns {Promise<object>} The result content from the server.
 */
async function executeMCPCommandStdio(commandName, args) {
  return new Promise((resolve, reject) => {
    console.log(`Spawning GitHub MCP server for command: ${commandName}`);
    const mcpServer = spawn('npx', ['@modelcontextprotocol/server-github'], {
      stdio: ['pipe', 'pipe', 'pipe'], // Use pipes for stdin, stdout, stderr
      shell: true, // Keep shell: true for npx
      env: {
        ...process.env, // Inherit environment
        GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN
      }
    });

    let responseData = '';
    let errorData = '';
    let responseComplete = false;

    mcpServer.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[MCP Server STDOUT] ${output.trim()}`);
      // Accumulate data - responses might be chunked
      responseData += output;

      // Attempt to parse JSON incrementally (simple check for now)
      // A more robust solution might buffer until a clear delimiter or timeout
      try {
        // Look for potential JSON object boundaries
        const potentialJson = responseData.substring(responseData.lastIndexOf('{'), responseData.lastIndexOf('}') + 1);
        if (potentialJson) {
          const result = JSON.parse(potentialJson);
          if (result && result.content !== undefined) { // Check if it looks like our expected result
            console.log('Parsed complete JSON response from MCP server.');
            responseComplete = true;
            resolve(result.content); // Resolve with the content
            if (!mcpServer.killed) mcpServer.kill(); // Terminate server once we have the response
          }
        }
      } catch (e) {
        // Ignore parsing errors until we likely have the full response
        // console.warn('MCP JSON parsing error (likely incomplete data):', e.message);
      }
    });

    mcpServer.stderr.on('data', (data) => {
      const errorOutput = data.toString().trim();
      // Only log unexpected stderr output
      if (!errorOutput.includes('GitHub MCP Server running on stdio')) {
         console.error(`[MCP Server STDERR - UNEXPECTED] ${errorOutput}`);
         errorData += errorOutput + '\n';
      }
    });

    mcpServer.on('error', (err) => {
      console.error('[MCP Server SPAWN ERROR]', err);
      reject(new Error(`Failed to spawn MCP GitHub server: ${err.message}`));
    });

    mcpServer.on('close', (code) => {
      console.log(`[MCP Server CLOSE] Process exited with code ${code}`);
      // If the promise hasn't already resolved (e.g., response received), reject
      if (!responseComplete) {
        if (errorData) {
          reject(new Error(`MCP Server failed with errors:\n${errorData}`));
        } else if (code !== 0) {
          reject(new Error(`MCP Server exited unexpectedly with code ${code}. Response so far: ${responseData}`));
        } else {
          // Should ideally have resolved if code is 0, but handle unexpected case
          reject(new Error('MCP Server closed without providing a complete response.')); 
        }
      }
    });

    // Send the command to the server's stdin
    const command = { name: commandName, args: args };
    const commandString = JSON.stringify(command);
    console.log(`Sending command to MCP server stdin: ${commandString}`);
    try {
      mcpServer.stdin.write(commandString + '\n'); // Add newline as a potential delimiter
      mcpServer.stdin.end(); // Close stdin to signal end of input
    } catch (e) {
      reject(new Error(`Failed to write to MCP server stdin: ${e.message}`));
    }

    // Timeout for safety, in case the server hangs or parsing fails
    const timeout = setTimeout(() => {
       if (!responseComplete) {
          console.error('[MCP Server TIMEOUT] No complete response received within 30 seconds.');
          if (!mcpServer.killed) mcpServer.kill();
          reject(new Error(`Timeout waiting for MCP server response. Error logs: ${errorData}`));
       }
    }, 30000); // 30-second timeout

    // Ensure timeout is cleared if promise resolves/rejects early
    mcpServer.on('close', () => clearTimeout(timeout));
  });
}

/**
 * Analyzes a PR diff using the LLM service via a direct HTTP call
 */
async function analyzePRWithLLM(prDiff) {
  // Set up the connection to the LLM provider
  const llmProviderPort = process.env.LLM_PROVIDER_PORT || 8090;
  const llmProviderUrl = `http://localhost:${llmProviderPort}/analyze`;
  
  console.log(`Sending PR diff (${prDiff ? prDiff.length : 'N/A'} characters) to LLM provider at ${llmProviderUrl}`);

  if (!prDiff) {
    console.error('Error: prDiff is empty or null before sending to LLM.');
    throw new Error('Cannot analyze an empty diff.');
  }

  // Send the PR diff for analysis to the LLM provider
  const response = await fetch(llmProviderUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      diff: prDiff,
      prompt: `
        You are a code reviewer assistant integrated with the GitHub MCP (Model Context Protocol) server. 
        Analyze the following pull request diff and provide a detailed assessment with the following structure:

        1. DECISION: Start with either "APPROVE" or "REJECT" on the first line.
        
        2. SUMMARY: Provide a brief 1-2 sentence summary of what the PR changes accomplish.
        
        3. KEY POINTS: List 3-5 bullet points about the PR that cover:
           • Features or improvements added
           • Potential disadvantages or drawbacks
           • Security considerations
           • Performance implications
           • Code quality observations
        
        Be specific with your observations, referencing actual code when relevant. If you approve the PR, still mention any minor issues or suggestions for improvement. If you reject it, clearly explain the critical issues that need to be addressed.
        
        Base your assessment on:
        - Code quality and best practices
        - Security vulnerabilities
        - Performance implications
        - Logic errors or bugs
        - Architecture and design considerations
        
        Be thorough but concise in your review.
      `
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`LLM request failed: ${response.status} ${response.statusText}`, errorBody);
    throw new Error(`LLM request failed: ${response.status} ${response.statusText}`);
  }

  const analysisResult = await response.json();
  console.log('Successfully received analysis from LLM provider.');
  return analysisResult.response;
}

// Main execution
async function main() {
  try {
    // Validate command line arguments
    const [owner, repo, prNumberStr] = process.argv.slice(2);
    if (!owner || !repo || !prNumberStr) {
      throw new Error('Missing required parameters. Usage: node analyze-pr.js <owner> <repo> <pr-number>');
    }
    const prNumber = parseInt(prNumberStr);
    if (isNaN(prNumber)) {
      throw new Error(`Invalid pr-number: ${prNumberStr}`);
    }
    
    // Ensure required env var is present for MCP server
    if (!process.env.GITHUB_TOKEN && !process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
      throw new Error('GITHUB_PERSONAL_ACCESS_TOKEN or GITHUB_TOKEN environment variable is required.');
    }

    // Fetch PR diff from GitHub MCP server using STDIO
    console.log(`Fetching PR diff for ${owner}/${repo}#${prNumber} via MCP STDIO...`);
    const prDiff = await executeMCPCommandStdio("get_diff_pr", {
      owner: owner,
      repo: repo,
      pr_number: prNumber
    });

    if (!prDiff) {
       throw new Error('Received empty diff from MCP server.');
    }
    console.log(`Successfully fetched PR diff (${prDiff.length} characters) via MCP STDIO.`);

    // Analyze PR diff using LLM (via HTTP to the separate LLM provider service)
    console.log('Analyzing PR diff with LLM...');
    const analysis = await analyzePRWithLLM(prDiff);

    console.log('\nAnalysis Result:');
    console.log('----------------');
    console.log(analysis);
    console.log('----------------');

  } catch (error) {
    console.error(`\nError analyzing PR: ${error.message}`);
    // Log the stack trace for detailed debugging
    if (error.stack) {
       console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
