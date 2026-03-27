import { z } from 'zod';
import { Logger } from '../utils/logger.js';
import { getBackend } from '../backends/index.js';
import { brainstormSessionManager } from '../utils/brainstormSessionManager.js';
function buildBrainstormPrompt(config) {
    const { prompt, methodology, domain, constraints, existingContext, ideaCount, includeAnalysis } = config;
    // Select methodology framework
    let frameworkInstructions = getMethodologyInstructions(methodology, domain);
    let enhancedPrompt = `# BRAINSTORMING SESSION

## Core Challenge
${prompt}

## Methodology Framework
${frameworkInstructions}

## Context Engineering
*Use the following context to inform your reasoning:*
${domain ? `**Domain Focus:** ${domain} - Apply domain-specific knowledge, terminology, and best practices.` : ''}
${constraints ? `**Constraints & Boundaries:** ${constraints}` : ''}
${existingContext ? `**Background Context:** ${existingContext}` : ''}

## Output Requirements
- Generate ${ideaCount} distinct, creative ideas
- Each idea should be unique and non-obvious
- Focus on actionable, implementable concepts
- Use clear, descriptive naming
- Provide brief explanations for each idea

${includeAnalysis ? `
## Analysis Framework
For each idea, provide:
- **Feasibility:** Implementation difficulty (1-5 scale)
- **Impact:** Potential value/benefit (1-5 scale)
- **Innovation:** Uniqueness/creativity (1-5 scale)
- **Quick Assessment:** One-sentence evaluation
` : ''}

## Format
Present ideas in a structured format:

### Idea [N]: [Creative Name]
**Description:** [2-3 sentence explanation]
${includeAnalysis ? '**Feasibility:** [1-5] | **Impact:** [1-5] | **Innovation:** [1-5]\n**Assessment:** [Brief evaluation]' : ''}

---

**Before finalizing, review the list: remove near-duplicates and ensure each idea satisfies the constraints.**

Begin brainstorming session:`;
    return enhancedPrompt;
}
/**
 * Returns methodology-specific instructions for structured brainstorming
 */
function getMethodologyInstructions(methodology, domain) {
    const methodologies = {
        'divergent': `**Divergent Thinking Approach:**
- Generate maximum quantity of ideas without self-censoring
- Build on wild or seemingly impractical ideas
- Combine unrelated concepts for unexpected solutions
- Use "Yes, and..." thinking to expand each concept
- Postpone evaluation until all ideas are generated`,
        'convergent': `**Convergent Thinking Approach:**
- Focus on refining and improving existing concepts
- Synthesize related ideas into stronger solutions
- Apply critical evaluation criteria
- Prioritize based on feasibility and impact
- Develop implementation pathways for top ideas`,
        'scamper': `**SCAMPER Creative Triggers:**
- **Substitute:** What can be substituted or replaced?
- **Combine:** What can be combined or merged?
- **Adapt:** What can be adapted from other domains?
- **Modify:** What can be magnified, minimized, or altered?
- **Put to other use:** How else can this be used?
- **Eliminate:** What can be removed or simplified?
- **Reverse:** What can be rearranged or reversed?`,
        'design-thinking': `**Human-Centered Design Thinking:**
- **Empathize:** Consider user needs, pain points, and contexts
- **Define:** Frame problems from user perspective
- **Ideate:** Generate user-focused solutions
- **Consider Journey:** Think through complete user experience
- **Prototype Mindset:** Focus on testable, iterative concepts`,
        'lateral': `**Lateral Thinking Approach:**
- Make unexpected connections between unrelated fields
- Challenge fundamental assumptions
- Use random word association to trigger new directions
- Apply metaphors and analogies from other domains
- Reverse conventional thinking patterns`,
        'auto': `**AI-Optimized Approach:**
${domain ? `Given the ${domain} domain, I'll apply the most effective combination of:` : 'I\'ll intelligently combine multiple methodologies:'}
- Divergent exploration with domain-specific knowledge
- SCAMPER triggers and lateral thinking
- Human-centered perspective for practical value`
    };
    return methodologies[methodology] || methodologies['auto'];
}
const brainstormArgsSchema = z.object({
    prompt: z.string().min(1).describe("Primary brainstorming challenge or question to explore"),
    backend: z.enum(['gemini', 'codex']).optional().describe("AI backend to use: 'gemini' (default) or 'codex'. Gemini offers 1M+ token context, Codex integrates with OpenAI models."),
    session: z.string().optional().describe("Session ID for tracking ideas across rounds (e.g., 'feature-ideas'). Enables iterative brainstorming with context."),
    model: z.string().optional().describe("Model override. Gemini: 'gemini-3.1-pro' (default), 'gemini-3-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'. Codex: 'gpt-5.4' (default), 'gpt-5.4-mini', 'gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.2'"),
    methodology: z.enum(['divergent', 'convergent', 'scamper', 'design-thinking', 'lateral', 'auto']).default('auto').describe("Brainstorming framework: 'divergent' (generate many ideas), 'convergent' (refine existing), 'scamper' (systematic triggers), 'design-thinking' (human-centered), 'lateral' (unexpected connections), 'auto' (AI selects best)"),
    domain: z.string().optional().describe("Domain context for specialized brainstorming (e.g., 'software', 'business', 'creative', 'research', 'product', 'marketing')"),
    constraints: z.string().optional().describe("Known limitations, requirements, or boundaries (budget, time, technical, legal, etc.)"),
    existingContext: z.string().optional().describe("Background information, previous attempts, or current state to build upon"),
    ideaCount: z.number().int().positive().default(12).describe("Target number of ideas to generate (default: 10-15)"),
    includeAnalysis: z.boolean().default(true).describe("Include feasibility, impact, and implementation analysis for generated ideas"),
    includeHistory: z.boolean().default(true).describe("Include previously generated ideas in context (only applies when session is provided). Default: true"),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh']).optional().describe("Reasoning effort level (Codex only): 'low', 'medium' (default), 'high', 'xhigh'. Use 'high'/'xhigh' for complex tasks."),
    allowedTools: z.array(z.string()).optional().describe("Tools that AI can auto-approve without confirmation (e.g., ['run_shell_command']). Use sparingly for security."),
    cwd: z.string().optional().describe("Working directory for CLI execution. Use this to match your IDE workspace directory if you get 'Directory mismatch' errors."),
});
export const brainstormTool = {
    name: "brainstorm",
    description: "Generate novel ideas with dynamic context gathering. --> Creative frameworks (SCAMPER, Design Thinking, etc.), domain context integration, idea clustering, feasibility analysis, and iterative refinement.",
    zodSchema: brainstormArgsSchema,
    annotations: {
        readOnlyHint: false, // Can modify state via sessions
        destructiveHint: false, // Doesn't delete data
        idempotentHint: false, // Same input yields different AI responses
        openWorldHint: true, // Interacts with external AI APIs
    },
    prompt: {
        description: "Generate structured brainstorming prompt with methodology-driven ideation, domain context integration, and analytical evaluation framework",
    },
    category: 'ai',
    execute: async (args, onProgress) => {
        const { prompt, backend: backendChoice, session, model, methodology = 'auto', domain, constraints, existingContext, ideaCount = 12, includeAnalysis = true, includeHistory = true, reasoningEffort, allowedTools, cwd } = args;
        if (!prompt?.trim()) {
            throw new Error("You must provide a valid brainstorming challenge or question to explore");
        }
        // Session handling
        let sessionData = null;
        let contextualizedExistingContext = existingContext;
        if (session) {
            try {
                sessionData = await brainstormSessionManager.getOrCreate(session, prompt.trim(), methodology, domain, constraints);
                // Build context from previous rounds
                if (includeHistory && sessionData.rounds.length > 0) {
                    const previousIdeas = brainstormSessionManager.buildIdeasContext(sessionData, true);
                    contextualizedExistingContext = existingContext
                        ? `${existingContext}\n\n${previousIdeas}`
                        : previousIdeas;
                }
                onProgress?.(`🧠 Session '${session}' (Round ${sessionData.rounds.length + 1})`);
            }
            catch (error) {
                onProgress?.(`⚠️  Session loading failed: ${error instanceof Error ? error.message : String(error)}`);
                Logger.error(`Failed to load session '${session}': ${error}`);
                // Continue without session
            }
        }
        let enhancedPrompt = buildBrainstormPrompt({
            prompt: prompt.trim(),
            methodology: methodology,
            domain: domain,
            constraints: constraints,
            existingContext: contextualizedExistingContext,
            ideaCount: ideaCount,
            includeAnalysis: includeAnalysis
        });
        Logger.debug(`Brainstorm: Using methodology '${methodology}' for domain '${domain || 'general'}'`);
        // Get the appropriate backend (defaults to session's last backend, then Gemini)
        const backendType = backendChoice || sessionData?.lastBackend || 'gemini';
        const backend = await getBackend(backendType);
        // Report progress to user
        onProgress?.(`🤖 Using ${backend.name} backend...`);
        onProgress?.(`Generating ${ideaCount} ideas via ${methodology} methodology...`);
        // Execute via the selected backend
        // Pass existing codexThreadId for native session resume when using Codex
        const result = await backend.execute(enhancedPrompt, {
            provider: backendType,
            model: model,
            sandbox: false,
            changeMode: false,
            allowedTools: allowedTools,
            cwd: cwd,
            codexThreadId: sessionData?.codexThreadId, // For Codex native session resume
            reasoningEffort: reasoningEffort,
        }, onProgress);
        // Save to session if provided
        if (session && sessionData) {
            try {
                // Parse ideas from response (simple extraction)
                const ideas = parseIdeasFromResponse(result.response);
                brainstormSessionManager.addRound(sessionData, prompt, result.response, ideas, backendType, result.codexThreadId // Store Codex thread ID for native session resume
                );
                await brainstormSessionManager.save(sessionData);
                onProgress?.(`💾 Saved to session '${session}' (${sessionData.totalIdeas} total ideas, ${sessionData.activeIdeas} active)`);
                if (result.codexThreadId && result.codexThreadId.length > 0) {
                    const threadPreview = result.codexThreadId.slice(0, 8);
                    onProgress?.(`🔗 Codex thread: ${threadPreview}...`);
                }
            }
            catch (error) {
                onProgress?.(`⚠️  Session save failed: ${error instanceof Error ? error.message : String(error)}`);
                Logger.error(`Failed to save session '${session}': ${error}`);
                // Continue - result is still valid even if session save failed
            }
        }
        // Use backend-aware response prefix
        const backendName = backend.name.charAt(0).toUpperCase() + backend.name.slice(1);
        return `${backendName} response:\n${result.response}`;
    }
};
/**
 * Escapes special regex characters in a string to prevent ReDoS attacks
 */
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/**
 * Safely parses an integer score, returning undefined for invalid values
 */
function parseScore(matchResult) {
    if (!matchResult)
        return undefined;
    const parsed = parseInt(matchResult[1], 10);
    return !isNaN(parsed) && parsed >= 1 && parsed <= 10 ? parsed : undefined;
}
/**
 * Parses ideas from brainstorm response
 * Extracts idea names, descriptions, and scores
 */
function parseIdeasFromResponse(response) {
    const ideas = [];
    // Pattern: ### Idea [N]: [Name]
    const ideaPattern = /###\s+Idea\s+\d+:\s*(.+?)\n\*\*Description:\*\*\s*(.+?)(?=\n###|\n\*\*Feasibility|\n---|$)/gis;
    let match;
    while ((match = ideaPattern.exec(response)) !== null) {
        const name = match[1].trim();
        const description = match[2].trim();
        // Escape regex metacharacters to prevent ReDoS attacks
        const escapedName = escapeRegex(name);
        // Try to extract scores with escaped name
        const feasibilityMatch = response.match(new RegExp(`${escapedName}[\\s\\S]{0,300}\\*\\*Feasibility:\\*\\*\\s*(\\d+)`, 'i'));
        const impactMatch = response.match(new RegExp(`${escapedName}[\\s\\S]{0,300}\\*\\*Impact:\\*\\*\\s*(\\d+)`, 'i'));
        const innovationMatch = response.match(new RegExp(`${escapedName}[\\s\\S]{0,300}\\*\\*Innovation:\\*\\*\\s*(\\d+)`, 'i'));
        ideas.push({
            name,
            description,
            feasibility: parseScore(feasibilityMatch),
            impact: parseScore(impactMatch),
            innovation: parseScore(innovationMatch)
        });
    }
    return ideas;
}
//# sourceMappingURL=brainstorm.tool.js.map