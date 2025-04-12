// .github/scripts/analyze-pr.js
const fetch = require('node-fetch');
const { spawn } = require('child_process');

/**
 * Executes a command on the GitHub MCP server via a temporary STDIO process.
 * 
 * @param {string} commandName - The name of the MCP command (e.g., "get_pull_request_diff").
 * @param {object} args - The arguments for the command.
 * @returns {Promise<string>} The result content (diff string) from the server.
 */
async function executeMCPCommandStdio(commandName, args) {
  return new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    if (!token) {
      return reject(new Error('GITHUB_TOKEN/GITHUB_PERSONAL_ACCESS_TOKEN environment variable is required for MCP STDIO execution.'));
    }
    
    console.log(`Spawning temporary GitHub MCP server via npx for command: ${commandName}`);
    const mcpServer = spawn('npx', ['@modelcontextprotocol/server-github'], {
      stdio: ['pipe', 'pipe', 'pipe'], // Use pipes for stdin, stdout, stderr
      shell: true, // Keep shell: true for npx
      env: {
        ...process.env, // Inherit environment
        // Ensure the server gets the token
        GITHUB_PERSONAL_ACCESS_TOKEN: token 
      }
    });

    let responseData = '';
    let errorData = '';
    let responseComplete = false;
    let jsonResponse = null;

    mcpServer.stdout.on('data', (data) => {
      const output = data.toString();
      // console.log(`[MCP Server STDOUT] ${output.trim()}`); // Usually too verbose
      responseData += output;

      // Try to parse potential JSON chunk - look for complete {} object
      try {
        const jsonStart = responseData.indexOf('{');
        const jsonEnd = responseData.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd > jsonStart) {
            const potentialJsonString = responseData.substring(jsonStart, jsonEnd + 1);
            jsonResponse = JSON.parse(potentialJsonString);
            // Check if it's the expected result format
            if (jsonResponse && jsonResponse.content !== undefined) { 
              console.log('Parsed complete JSON response from MCP server via stdio.');
              responseComplete = true;
              resolve(jsonResponse.content); // Resolve with the content
              clearTimeout(timeoutId); // Clear timeout
            } else if (jsonResponse && jsonResponse.error) {
              console.error('MCP server returned an error via stdio:', jsonResponse.error);
              responseComplete = true;
              reject(new Error(`MCP Server Error: ${jsonResponse.error} - ${jsonResponse.message || ''}`));
              clearTimeout(timeoutId);
            }
        }
      } catch (e) {
        // Ignore parsing errors, likely incomplete JSON
      }
    });

    mcpServer.stderr.on('data', (data) => {
      const errorOutput = data.toString().trim();
      // Log ALL stderr output for debugging
      console.error(`[MCP Server STDERR - RAW] ${errorOutput}`); 
      errorData += errorOutput + '\n';
      /* // Keep old filter commented out for now
      if (errorOutput && !errorOutput.includes('GitHub MCP Server running on stdio')) {
         console.error(`[MCP Server STDERR] ${errorOutput}`);
         errorData += errorOutput + '\n';
      }
      */
    });

    mcpServer.on('error', (err) => {
      console.error('[MCP Server SPAWN ERROR]', err);
      reject(new Error(`Failed to spawn MCP GitHub server via npx: ${err.message}`));
    });

    mcpServer.on('close', (code) => {
      // console.log(`[MCP Server CLOSE] Process exited with code ${code}`);
      if (!responseComplete) {
        clearTimeout(timeoutId); // Clear timeout
        const errorMessage = errorData 
            ? `MCP Server failed via stdio with errors:\n${errorData}`
            : `MCP Server process (stdio) exited unexpectedly with code ${code}. No valid response received. Data received: ${responseData}`;
        reject(new Error(errorMessage));
      }
    });

    // Send the command to the server's stdin
    const command = { name: commandName, args: args };
    const commandString = JSON.stringify(command);
    // console.log(`Sending command to MCP server stdin: ${commandString}`);
    try {
      mcpServer.stdin.write(commandString + '\n'); 
      mcpServer.stdin.end();
    } catch (e) {
      reject(new Error(`Failed to write to MCP server stdin: ${e.message}`));
    }

    // Timeout for safety
    const timeoutId = setTimeout(() => {
       if (!responseComplete) {
          console.error('[MCP Server TIMEOUT] No complete response received via stdio within 60 seconds.');
          if (!mcpServer.killed) mcpServer.kill();
          reject(new Error(`Timeout waiting for MCP server stdio response. Errors: ${errorData}`));
       }
    }, 60000); // Increased to 60-second timeout

  });
}

/**
 * Analyzes a PR diff using the LLM service via a direct HTTP call
 */
async function analyzePRWithLLM(prDiff) {
  // Set up the connection to the LLM provider (This part remains HTTP)
  const llmProviderPort = process.env.LLM_PROVIDER_PORT;
  if (!llmProviderPort) {
      throw new Error('LLM_PROVIDER_PORT environment variable is not set. Cannot connect to LLM provider.');
  }
  const llmProviderUrl = `http://localhost:${llmProviderPort}/execute`; // Assuming /execute for LLM provider too

  console.log(`Connecting to running LLM provider at http://localhost:${llmProviderPort} to analyze diff`);

  if (!prDiff) {
    console.error('Error: prDiff is empty or null before sending to LLM.');
    throw new Error('Cannot analyze an empty diff.');
  }

  try {
      const response = await fetch(llmProviderUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            // Match the expected tool name and args for the LLM provider
            name: "analyze_pr_diff", 
            args: {
                diff: prDiff,
                // Add other args like prompt_instructions if needed
            }
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        console.error(`LLM provider request failed: ${response.status} ${response.statusText}`, errorBody);
        throw new Error(`LLM provider request failed: ${response.status} ${response.statusText}`);
      }

      const analysisResult = await response.json();

      if (analysisResult.error) {
          throw new Error(`LLM provider execution returned an error: ${analysisResult.error} - ${analysisResult.message || ''}`);
      }
      
      if (analysisResult.content === undefined || analysisResult.content === null) {
          throw new Error('No analysis content returned from LLM provider.');
      }

      console.log('Successfully received analysis from LLM provider.');
      return analysisResult.content;

  } catch (error) {
      console.error(`Failed to get analysis from LLM provider: ${error.message}`);
      throw error;
  }
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
    
    // GITHUB_TOKEN check is now primarily handled by the server starter (index.js/cli.js)
    // but the executeMCPCommandStdio function also checks it.
    // LLM_PROVIDER_PORT is needed for analyzePRWithLLM
    if (!process.env.LLM_PROVIDER_PORT) {
      throw new Error('LLM_PROVIDER_PORT environment variable is required for the analyzer script.');
    }

    // Fetch PR diff from GitHub MCP server using a temporary STDIO process
    console.log(`Fetching PR diff for ${owner}/${repo}#${prNumber} via MCP STDIO...`);
    const prDiff = await executeMCPCommandStdio("get_pull_request_diff", { // Assuming this command name is correct
      owner: owner,
      repo: repo,
      pull_number: prNumber
    });

    if (prDiff === null || prDiff === undefined) { 
       throw new Error('Failed to fetch PR diff from MCP server via stdio. See previous logs.');
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
    if (error.stack) {
       console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
