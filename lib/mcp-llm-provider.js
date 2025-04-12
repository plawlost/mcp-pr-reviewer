// .github/scripts/mcp-llm-provider.js
// This server acts as a dedicated MCP server for PR analysis using OpenRouter.
// It expects to receive the PR diff content via an MCP call.
const express = require('express');
const OpenAI = require('openai');
const app = express();
const port = process.env.LLM_PROVIDER_PORT || 8090; // Port for this specific MCP server

app.use(express.json());

// Ensure API Key is available
if (!process.env.OPENROUTER_API_KEY) {
  console.error('FATAL ERROR: OPENROUTER_API_KEY environment variable is not set.');
  process.exit(1); // Exit if key is missing
}

const openai = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env.OPENROUTER_API_KEY,
  defaultHeaders: {
    "HTTP-Referer": process.env.SITE_URL || "https://github.com/mcp-pr-reviewer", 
    "X-Title": process.env.SITE_NAME || "MCP PR Reviewer",
  },
});

// --- MCP Capabilities Endpoint ---
app.get('/capabilities', (req, res) => {
  res.json({
    name: "PR Reviewer LLM Analyzer", // More specific name
    version: "1.1.0", // Updated version
    tools: [
      {
        name: "analyze_pr_diff",
        description: "Analyzes a provided code diff string using an LLM (via OpenRouter) and returns a structured review.",
        parameters: [
          {
            name: "diff",
            type: "string",
            description: "The code diff content to be analyzed."
          },
          {
            name: "prompt_instructions", // Optional custom prompt
            type: "string",
            description: "Optional: Specific instructions to include in the system prompt for the LLM.",
            required: false
          }
        ]
      }
    ]
  });
});

// --- MCP Execute Endpoint ---
app.post('/execute', async (req, res) => {
  try {
    const { name, args } = req.body;
    
    if (name !== 'analyze_pr_diff') {
      return res.status(400).json({ error: 'Unknown tool name.', message: `Tool '${name}' is not supported.` });
    }
    
    const { diff, prompt_instructions } = args;
    
    if (!diff) {
      return res.status(400).json({ 
        error: 'Missing required parameter', 
        message: "The 'diff' parameter is required." 
      });
    }

    // Construct the prompt
    const defaultPrompt = `
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
    `;
    const systemPrompt = prompt_instructions ? `${defaultPrompt}\n\nAdditional Instructions: ${prompt_instructions}` : defaultPrompt;

    console.log(`Analyzing PR diff (${diff.length} characters) via OpenRouter...`);
    
    const completion = await openai.chat.completions.create({
      model: process.env.LLM_MODEL || "openrouter/optimus-alpha", 
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Here is the PR diff to analyze:\n\n${diff}` }
      ],
      max_tokens: 6000, 
      temperature: 0.2, 
    });

    if (!completion.choices || !completion.choices[0] || !completion.choices[0].message || !completion.choices[0].message.content) {
      console.error('Invalid response structure from OpenRouter API:', completion);
      throw new Error('Invalid response structure from LLM API');
    }

    const analysisResult = completion.choices[0].message.content;
    console.log('LLM analysis completed successfully.');
    
    // Return result in MCP format
    res.json({ content: analysisResult });

  } catch (error) {
    console.error('Error during tool execution:', error);
    res.status(500).json({ 
      error: 'Execution failed', 
      message: error.message, 
      details: error.response ? error.response.data : (error.stack || null)
    });
  }
});

// --- Remove old /analyze endpoint ---
/*
app.post('/analyze', async (req, res) => {
  // ... old implementation ...
});
*/

app.listen(port, () => {
  console.log(`MCP PR Reviewer LLM Analyzer server running on port ${port}`);
  console.log(`Using model: ${process.env.LLM_MODEL || "openrouter/optimus-alpha"}`);
  console.log("Waiting for /execute calls for the 'analyze_pr_diff' tool...");
});
