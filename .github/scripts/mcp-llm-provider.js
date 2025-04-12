// .github/scripts/mcp-llm-provider.js
// This server acts as an OpenRouter LLM provider separate from the MCP GitHub server
// It provides LLM analysis capabilities while the MCP GitHub server handles GitHub interactions
const express = require('express');
const OpenAI = require('openai');
const app = express();
const port = process.env.LLM_PROVIDER_PORT || 8090; // Use a different port than MCP GitHub server

app.use(express.json());

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": process.env.SITE_URL || "https://github.com/mcp-pr-reviewer", // Optional site URL for rankings
    "X-Title": process.env.SITE_NAME || "MCP PR Reviewer", // Optional site title for rankings
  },
});

// Add MCP capabilities endpoint
app.get('/capabilities', (req, res) => {
  res.json({
    name: "PR Reviewer",
    version: "1.0.1",
    tools: [
      {
        name: "analyze_pr",
        description: "Analyze a GitHub pull request for quality, issues, and make approval decisions",
        parameters: [
          {
            name: "owner",
            type: "string",
            description: "The repository owner (username or organization)"
          },
          {
            name: "repo",
            type: "string",
            description: "The repository name"
          },
          {
            name: "pr_number",
            type: "number",
            description: "The pull request number to analyze"
          }
        ]
      }
    ]
  });
});

// Add execute endpoint for MCP protocol
app.post('/execute', async (req, res) => {
  try {
    const { name, args } = req.body;
    
    if (name !== 'analyze_pr') {
      return res.status(400).json({ error: 'Unknown tool' });
    }
    
    const { owner, repo, pr_number } = args;
    
    if (!owner || !repo || !pr_number) {
      return res.status(400).json({ 
        error: 'Missing parameters', 
        message: 'Required parameters: owner, repo, pr_number' 
      });
    }
    
    // We'll implement this analysis later by calling the analyze-pr.js script
    // For now, return a placeholder response
    console.log(`Received request to analyze PR #${pr_number} in ${owner}/${repo}`);
    
    res.json({
      content: `PR Analysis for ${owner}/${repo}#${pr_number} would appear here.
Please use the command line tool directly for full functionality:

npx mcp-pr-reviewer analyze ${owner} ${repo} ${pr_number}

The MCP integration is under development.`
    });
    
  } catch (error) {
    console.error('Error during tool execution:', error);
    res.status(500).json({ 
      error: 'Execution failed', 
      message: error.message 
    });
  }
});

app.post('/analyze', async (req, res) => {
  try {
    const { diff, prompt } = req.body;
    
    if (!diff) {
      return res.status(400).json({ error: 'Missing PR diff in request' });
    }
    
    if (!prompt) {
      return res.status(400).json({ error: 'Missing analysis prompt in request' });
    }

    console.log(`Analyzing PR diff (${diff.length} characters) with LLM...`);
    
    const completion = await openai.chat.completions.create({
      model: process.env.LLM_MODEL || "openrouter/optimus-alpha",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: `Here is the PR diff to analyze:\n\n${diff}` }
      ],
      max_tokens: 6000, // Increased to allow for more detailed response
      temperature: 0.2, // Lower temperature for more deterministic responses
    });

    if (!completion.choices || !completion.choices[0] || !completion.choices[0].message) {
      throw new Error('Invalid response structure from LLM API');
    }

    const response = completion.choices[0].message.content;
    console.log('LLM analysis completed successfully');
    
    res.json({ response });
  } catch (error) {
    console.error('Error during LLM analysis:', error);
    
    // Provide more detailed error response
    if (error.response) {
      console.error('API error details:', error.response.data);
    }
    
    res.status(500).json({ 
      error: 'Analysis failed', 
      message: error.message,
      details: error.response ? error.response.data : null
    });
  }
});

app.listen(port, () => {
  console.log(`LLM provider for PR analysis running on port ${port}`);
  console.log(`Using model: ${process.env.LLM_MODEL || "openrouter/optimus-alpha"}`);
});
