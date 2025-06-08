const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

class BranchStrategyHandler {
    constructor(configPath) {
        this.config = yaml.load(fs.readFileSync(configPath, 'utf8'));
        this.branchStrategies = this.config.branchStrategy || [];
    }

    /**
     * Get branch strategy configuration for a specific repository
     * @param {string} repo - Repository name (e.g., 'org/repo-name')
     * @returns {object} Strategy configuration with defaults applied
     */
    getStrategyForRepo(repo) {
        // Find specific strategy for this repo
        let matchedStrategy = null;
        for (const strategy of this.branchStrategies) {
            if (Array.isArray(strategy.repoTargets)) {
                if (strategy.repoTargets.includes(repo)) {
                    matchedStrategy = strategy;
                    break;
                }
            } else if (strategy.repoTargets === repo) {
                matchedStrategy = strategy;
                break;
            }
        }

        // If no specific strategy found, find default strategy
        if (!matchedStrategy) {
            matchedStrategy = this.branchStrategies.find(s => s.repoTargets === 'default');
        }

        // If still no strategy found, use fallback
        if (!matchedStrategy) {
            return {
                mode: 'unique_branch_pr',
                branchName: 'update-ai-rules',
                targetBranch: 'main',
                basePath: this.config.basePath || ''
            };
        }

        // Return strategy with basePath support - fallback to global config basePath if not specified
        return {
            mode: matchedStrategy.mode,
            branchName: matchedStrategy.branchName,
            targetBranch: matchedStrategy.targetBranch,
            basePath: matchedStrategy.basePath !== undefined 
                ? matchedStrategy.basePath 
                : (this.config.basePath || '')
        };
    }

    /**
     * Generate branch name based on strategy mode
     * @param {object} strategy - Strategy configuration
     * @returns {string} Branch name
     */
    generateBranchName(strategy) {
        switch (strategy.mode) {
            case 'unique_branch_pr':
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
                return `${strategy.branchName || 'update-ai-rules'}-${timestamp}`;
            
            case 'reuse_branch_pr':
            case 'redo_branch_pr':
                return strategy.branchName || 'ai-rules-update';
            
            case 'direct_commit':
                return strategy.targetBranch || 'main';
            
            default:
                throw new Error(`Unknown branch strategy mode: ${strategy.mode}`);
        }
    }

    /**
     * Validate strategy configuration
     * @param {object} strategy - Strategy configuration
     * @throws {Error} If configuration is invalid
     */
    validateStrategy(strategy) {
        const validModes = ['unique_branch_pr', 'reuse_branch_pr', 'redo_branch_pr', 'direct_commit'];
        
        if (!validModes.includes(strategy.mode)) {
            throw new Error(`Invalid branch strategy mode: ${strategy.mode}. Valid modes: ${validModes.join(', ')}`);
        }

        if (strategy.mode !== 'direct_commit' && !strategy.branchName) {
            throw new Error(`Branch name is required for mode: ${strategy.mode}`);
        }

        if (!strategy.targetBranch) {
            throw new Error(`Target branch is required for mode: ${strategy.mode}`);
        }

        // Validate basePath if provided
        if (strategy.basePath !== undefined && strategy.basePath !== null) {
            if (typeof strategy.basePath !== 'string') {
                throw new Error(`basePath must be a string, got: ${typeof strategy.basePath}`);
            }
            
            // Check for invalid path characters (basic validation)
            const invalidChars = /[<>:"|?*]/;
            if (invalidChars.test(strategy.basePath)) {
                throw new Error(`basePath contains invalid characters: ${strategy.basePath}`);
            }
            
            // Prevent absolute paths that could be security risks
            if (path.isAbsolute(strategy.basePath)) {
                throw new Error(`basePath must be relative, not absolute: ${strategy.basePath}`);
            }
        }
    }

    /**
     * Check if a branch exists in the repository
     * @param {string} branchName - Name of the branch to check
     * @returns {boolean} True if branch exists
     */
    async branchExists(branchName) {
        try {
            const { execSync } = require('child_process');
            execSync(`git rev-parse --verify origin/${branchName}`, { stdio: 'pipe' });
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Check if a Pull Request exists for the branch
     * @param {string} repo - Repository name
     * @param {string} branchName - Branch name
     * @param {string} token - GitHub token
     * @returns {Promise<object|null>} PR object if exists, null otherwise
     */
    async findExistingPR(repo, branchName, token) {
        try {
            const { execSync } = require('child_process');
            const response = execSync(`curl -s -H "Authorization: token ${token}" -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/${repo}/pulls?head=${repo.split('/')[0]}:${branchName}&state=open"`, { encoding: 'utf8' });
            
            const prs = JSON.parse(response);
            return prs.length > 0 ? prs[0] : null;
        } catch (error) {
            console.error('Error checking for existing PR:', error.message);
            return null;
        }
    }

    /**
     * Update an existing Pull Request
     * @param {string} repo - Repository name
     * @param {number} prNumber - PR number
     * @param {string} title - PR title
     * @param {string} body - PR body
     * @param {string} token - GitHub token
     */
    async updatePR(repo, prNumber, title, body, token) {
        try {
            const { execSync } = require('child_process');
            const updateData = JSON.stringify({ title, body });
            
            execSync(`curl -X PATCH -H "Authorization: token ${token}" -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/${repo}/pulls/${prNumber}" -d '${updateData}'`, { stdio: 'inherit' });
            
            console.log(`Updated existing PR #${prNumber} for repository: ${repo}`);
        } catch (error) {
            console.error('Error updating PR:', error.message);
            throw error;
        }
    }

    /**
     * Create a new Pull Request
     * @param {string} repo - Repository name
     * @param {string} title - PR title
     * @param {string} body - PR body
     * @param {string} head - Head branch
     * @param {string} base - Base branch
     * @param {string} token - GitHub token
     */
    async createPR(repo, title, body, head, base, token) {
        try {
            const { execSync } = require('child_process');
            const prData = JSON.stringify({ title, body, head, base });
            
            const response = execSync(`curl -X POST -H "Authorization: token ${token}" -H "Accept: application/vnd.github.v3+json" "https://api.github.com/repos/${repo}/pulls" -d '${prData}'`, { encoding: 'utf8' });
            
            const pr = JSON.parse(response);
            console.log(`Created new PR #${pr.number} for repository: ${repo}`);
            return pr;
        } catch (error) {
            console.error('Error creating PR:', error.message);
            throw error;
        }
    }
}

module.exports = BranchStrategyHandler; 