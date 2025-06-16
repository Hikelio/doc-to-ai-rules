const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

class RuleCleanupHandler {
    constructor(targetDir, configuredProjectTypes) {
        this.targetDir = targetDir;
        this.configuredProjectTypes = configuredProjectTypes || [];
    }

    /**
     * Find all .mdc files in a directory using the best available method
     * @param {string} dir - Directory to search
     * @returns {Array} Array of file paths
     */
    async findMdcFiles(dir) {
        // Check if directory exists first
        if (!fs.existsSync(dir)) {
            console.log(`[WARNING] ⚠️ Directory ${dir} does not exist (if unexpected, check that project types match perfectly in markdown and config)`);
            return [];
        }

        const methods = [
            {
                name: 'fd',
                execute: () => {
                    const { execSync } = require('child_process');
                    const output = execSync(`fd -e mdc -t f . "${dir}"`, { encoding: 'utf8' });
                    return output.trim().split('\n').filter(line => line.trim());
                }
            },
            {
                name: 'find', 
                execute: () => {
                    const { execSync } = require('child_process');
                    const output = execSync(`find "${dir}" -name "*.mdc" -type f 2>/dev/null || true`, { encoding: 'utf8' });
                    return output.trim().split('\n').filter(line => line.trim());
                }
            },
            {
                name: 'JavaScript fallback',
                execute: () => this.findMdcFilesJS(dir)
            }
        ];

        for (const method of methods) {
            try {
                const files = await method.execute();
                console.log(`[DEBUG]  Found ${files.length} .mdc files using ${method.name}`);
                return files;
            } catch (error) {
                console.log(`[DEBUG]  ${method.name} failed, trying next method:`, error.message);
            }
        }

        console.warn('Warning: All file discovery methods failed');
        return [];
    }

    /**
     * Find all .mdc files recursively using JavaScript (fallback for systems without fd/find)
     * @param {string} dir - Directory to search
     * @returns {Array} Array of file paths
     */
    async findMdcFilesJS(dir) {
        const files = [];
        
        async function walk(currentDir) {
            try {
                const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(currentDir, entry.name);
                    if (entry.isDirectory()) {
                        await walk(fullPath);
                    } else if (entry.isFile() && entry.name.endsWith('.mdc')) {
                        files.push(fullPath);
                    }
                }
            } catch (error) {
                console.warn(`Warning: Could not read directory ${currentDir}:`, error.message);
            }
        }
        
        await walk(dir);
        return files;
    }

    /**
     * Find all .mdc files in the target directory with ai-rules-project metadata
     * @returns {Array} Array of {filePath, projectType, relativePath} objects
     */
    async findExistingRules() {
        const mdcFiles = await this.findMdcFiles(this.targetDir);
        const rules = [];
        
        // Process each file to check for ai-rules-project metadata
        for (const filePath of mdcFiles) {
            try {
                const content = await fs.promises.readFile(filePath, 'utf8');
                const parsed = matter(content);
                const projectType = parsed.data['ai-rules-project'];
                
                if (projectType && this.configuredProjectTypes.includes(projectType)) {
                    const relativePath = path.relative(this.targetDir, filePath);
                    rules.push({
                        filePath: filePath,
                        relativePath: relativePath,
                        projectType: projectType,
                        frontmatter: parsed.data,
                        content: parsed.content
                    });
                }
            } catch (error) {
                console.warn(`Warning: Could not parse .mdc file ${filePath}:`, error.message);
            }
        }
        
        return rules;
    }

    /**
     * Get list of current rule paths from generated rules
     * @param {string} generatedRulesDir - Directory containing newly generated rules
     * @returns {Set} Set of relative paths (e.g., 'pathC/section_name.mdc', 'section_name.mdc')
     */
    async getCurrentRulePaths(generatedRulesDir) {
        const mdcFiles = await this.findMdcFiles(generatedRulesDir);
        const rulePaths = new Set();
        
        // Extract relative paths from filenames
        for (const filePath of mdcFiles) {
            const relativePath = path.relative(generatedRulesDir, filePath);
            // Normalize path separators for consistent comparison
            const normalizedPath = relativePath.replace(/\\/g, '/');
            rulePaths.add(normalizedPath);
        }
        
        return rulePaths;
    }

    /**
     * Delete orphaned rules that don't exist in current generation
     * @param {string} generatedRulesDir - Directory containing newly generated rules
     * @returns {Array} Array of deleted file paths
     */
    async cleanupOrphanedRules(generatedRulesDir) {
        console.log(`\nStarting rule cleanup - deleting rules not in current generation`);
        
        const existingRules = await this.findExistingRules();
        console.log(`Found ${existingRules.length} existing rules with ai-rules-project metadata`);
        
        // Get current rule paths from generated rules (full relative paths, not just filenames)
        const currentRulePaths = await this.getCurrentRulePaths(generatedRulesDir);
        console.log(`Current rule paths: ${Array.from(currentRulePaths).join(', ')}`);
        
        const deletedFiles = [];
        
        for (const rule of existingRules) {
            // Normalize the existing rule's relative path for comparison
            const normalizedExistingPath = rule.relativePath.replace(/\\/g, '/');
            
            // Delete if the exact path doesn't exist in current generation
            if (!currentRulePaths.has(normalizedExistingPath)) {
                try {
                    await fs.promises.unlink(rule.filePath);
                    console.log(`Deleted orphaned rule: ${rule.relativePath} (project: ${rule.projectType})`);
                    deletedFiles.push(rule.filePath);
                    
                    // Also clean up empty directories
                    await this.cleanupEmptyDirectories(path.dirname(rule.filePath));
                } catch (error) {
                    console.warn(`Warning: Could not delete ${rule.filePath}:`, error.message);
                }
            }
        }
        
        if (deletedFiles.length > 0) {
            console.log(`Cleanup complete: ${deletedFiles.length} orphaned rules deleted`);
        } else {
            console.log('Cleanup complete: no orphaned rules found');
        }
        
        return deletedFiles;
    }

    /**
     * Clean up empty directories recursively
     * @param {string} dirPath - Directory path to check
     */
    async cleanupEmptyDirectories(dirPath) {
        try {
            // Don't delete if it's the root target directory
            if (dirPath === this.targetDir) {
                return;
            }
            
            const entries = await fs.promises.readdir(dirPath);
            if (entries.length === 0) {
                await fs.promises.rmdir(dirPath);
                console.log(`Removed empty directory: ${dirPath}`);
                
                // Recursively check parent directory
                await this.cleanupEmptyDirectories(path.dirname(dirPath));
            }
        } catch (error) {
            // Directory might not be empty or might not exist, which is fine
        }
    }
}

module.exports = RuleCleanupHandler;