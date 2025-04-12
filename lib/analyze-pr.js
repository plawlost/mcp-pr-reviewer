// .github/scripts/analyze-pr.js
const fetch = require('node-fetch');

/**
 * Fetches a PR diff from the running GitHub MCP server via HTTP.
 * 
 * @param {string} owner - The repository owner.
 * @param {string} repo - The repository name.
 * @param {number} prNumber - The pull request number.
 * @returns {Promise<string>} The PR diff content.
 */
async function fetchPRDiffFromMCP(owner, repo, prNumber) {
  const mcpPort = process.env.MCP_GITHUB_PORT;
  if (!mcpPort) {
    throw new Error('MCP_GITHUB_PORT environment variable is not set. Cannot connect to MCP server.');
  }
  const mcpUrl = `http://localhost:${mcpPort}`;

  console.log(`Connecting to running MCP GitHub server at ${mcpUrl} to fetch diff for ${owner}/${repo}#${prNumber}`);

  try {
    // Ensure the server is available first (optional but good practice)
    const capabilitiesRes = await fetch(`${mcpUrl}/capabilities`);
    if (!capabilitiesRes.ok) {
      throw new Error(`MCP server at ${mcpUrl} not available or returned error: ${capabilitiesRes.status} ${capabilitiesRes.statusText}`);
    }
    console.log('MCP server is available.');

    // Execute the get_pull_request_diff command (adjust command name if needed based on server implementation)
    const commandName = "get_pull_request_diff"; // Or potentially "get_diff_pr"
    const response = await fetch(`${mcpUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Add Authorization header if the MCP server requires it for execute endpoint
        // 'Authorization': `Bearer ${process.env.GITHUB_TOKEN}` 
      },
      body: JSON.stringify({
        name: commandName,
        args: {
          owner: owner,
          repo: repo,
          pull_number: prNumber // Use pull_number as per your suggestion
        }
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`MCP GitHub server execution failed: ${response.status} ${response.statusText}. Body: ${errorBody}`);
    }

    const result = await response.json();

    if (result.error) {
        throw new Error(`MCP execution returned an error: ${result.error} - ${result.message || ''}`);
    }

    if (result.content === undefined || result.content === null) {
      console.warn('MCP server returned result without content field:', result);
      throw new Error('No diff content returned from MCP GitHub server. Check server logs.');
    }

    console.log(`Successfully fetched PR diff (${result.content.length} characters)`);
    return result.content;
  } catch (error) {
    console.error(`Failed to fetch PR diff from MCP server: ${error.message}`);
    // Rethrow the error to be caught by main()
    throw error; 
  }
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
    
    // GITHUB_TOKEN check is now primarily handled by the server starter (index.js/cli.js)
    // We still need the MCP_GITHUB_PORT to know where to connect
    if (!process.env.MCP_GITHUB_PORT) {
      throw new Error('MCP_GITHUB_PORT environment variable is required for the analyzer script.');
    }

    // Fetch PR diff from the *running* GitHub MCP server
    console.log(`Fetching PR diff for ${owner}/${repo}#${prNumber} via MCP HTTP client...`);
    const prDiff = await fetchPRDiffFromMCP(owner, repo, prNumber);

    if (prDiff === null || prDiff === undefined) { // Check if fetch failed and threw, or somehow returned null/undefined
       throw new Error('Failed to fetch PR diff from MCP server. See previous logs.');
    }

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
