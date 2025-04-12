// .github/scripts/analyze-pr.js
const fetch = require('node-fetch');

/**
 * Fetches a PR diff from the GitHub MCP server
 */
async function fetchPRDiffFromMCP(owner, repo, prNumber) {
  // Set up the MCP client connection - MCP GitHub server
  const mcpGithubPort = process.env.MCP_GITHUB_PORT || 8080;
  const mcpGithubUrl = `http://localhost:${mcpGithubPort}`;
  
  console.log(`Fetching PR diff for ${owner}/${repo}#${prNumber} from GitHub MCP server`);
  
  try {
    // Call the get_diff_pr endpoint on the GitHub MCP server
    const response = await fetch(`${mcpGithubUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: "get_diff_pr",
        args: {
          owner: owner,
          repo: repo,
          pr_number: parseInt(prNumber)
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`MCP GitHub server returned error: ${response.status} ${response.statusText}`);
    }
    
    const result = await response.json();
    
    if (!result.content) {
      throw new Error('No diff content returned from MCP GitHub server');
    }
    
    console.log(`Successfully fetched PR diff (${result.content.length} characters)`);
    return result.content;
  } catch (error) {
    throw new Error(`Failed to fetch PR diff: ${error.message}`);
  }
}

/**
 * Analyzes a PR diff using the LLM service via a direct HTTP call
 */
async function analyzePRWithLLM(prDiff) {
  // Set up the connection to the LLM provider
  const llmProviderPort = process.env.LLM_PROVIDER_PORT || 8090;
  const llmProviderUrl = `http://localhost:${llmProviderPort}/analyze`;
  
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
    throw new Error(`LLM request failed: ${response.statusText}`);
  }

  const analysisResult = await response.json();
  return analysisResult.response;
}

/**
 * Verifies that the MCP GitHub server is running and available
 */
async function verifyMCPServerAvailability() {
  const mcpGithubPort = process.env.MCP_GITHUB_PORT || 8080;
  const mcpGithubUrl = `http://localhost:${mcpGithubPort}`;
  
  try {
    const mcpResponse = await fetch(`${mcpGithubUrl}/capabilities`);
    if (!mcpResponse.ok) {
      console.warn('Warning: MCP GitHub server may not be available or not responding correctly');
      return false;
    } else {
      console.log('MCP GitHub server is available');
      return true;
    }
  } catch (error) {
    console.warn(`Warning: Could not connect to MCP GitHub server: ${error.message}`);
    return false;
  }
}

// Main execution
async function main() {
  try {
    // Validate command line arguments
    const [owner, repo, prNumber] = process.argv.slice(2);
    if (!owner || !repo || !prNumber) {
      throw new Error('Missing required parameters. Usage: node analyze-pr.js <owner> <repo> <pr-number>');
    }
    
    // Verify MCP server is available
    const isServerAvailable = await verifyMCPServerAvailability();
    if (!isServerAvailable) {
      throw new Error('MCP GitHub server is not available. Please ensure it is running.');
    }
    
    // Fetch PR diff from GitHub MCP server
    const prDiff = await fetchPRDiffFromMCP(owner, repo, prNumber);
    
    // Analyze PR diff using LLM
    const analysis = await analyzePRWithLLM(prDiff);
    console.log('Analysis Result:');
    console.log('----------------');
    console.log(analysis);
  } catch (error) {
    console.error(`Error analyzing PR: ${error.message}`);
    process.exit(1);
  }
}

main();
