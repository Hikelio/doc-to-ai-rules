const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const RuleCleanupHandler = require('./ruleCleanupHandler');
const BranchStrategyHandler = require('./branchStrategyHandler');

// Get command line arguments
const [, , targetRepo, configPath, sourceBaseDir, targetBaseDir] = process.argv;

console.log('DEBUG: copyRulesToRepo.js called with:');
console.log('  targetRepo:', targetRepo);
console.log('  configPath:', configPath);
console.log('  sourceBaseDir:', sourceBaseDir);
console.log('  targetBaseDir:', targetBaseDir);

if (!targetRepo || !configPath || !sourceBaseDir || !targetBaseDir) {
    console.error('Usage: node copyRulesToRepo.js <targetRepo> <configPath> <sourceBaseDir> <targetBaseDir>');
    process.exit(1);
}

// Read and parse config file
const config = yaml.load(fs.readFileSync(configPath, 'utf8'));

// Get project types for the target repository
const targetProjectTypes = config.exports[targetRepo] || [];

console.log('DEBUG: Target project types for', targetRepo, ':', targetProjectTypes);

if (!targetProjectTypes.length) {
    console.error(`No project types defined for repository: ${targetRepo}`);
    process.exit(1);
}

// Get branch strategy
const branchStrategyHandler = new BranchStrategyHandler(configPath);
const strategy = branchStrategyHandler.getStrategyForRepo(targetRepo);

console.log('DEBUG: Branch strategy for', targetRepo, ':', strategy);

// Apply repo-specific basePath to determine effective target directory
const repoBasePath = strategy.basePath || '';
const effectiveTargetBaseDir = repoBasePath 
    ? path.join(targetBaseDir, repoBasePath)
    : targetBaseDir;

console.log('DEBUG: Repo-specific basePath:', repoBasePath);
console.log('DEBUG: Effective target base directory:', effectiveTargetBaseDir);

console.log('DEBUG: Current working directory:', process.cwd());
console.log('DEBUG: Source base directory:', sourceBaseDir);

// Initialize cleanup handler for the entire repository (not just effective target dir)
// This ensures we can find and clean up orphaned rules even if basePath changed
const ruleCleanupHandler = new RuleCleanupHandler(targetBaseDir, targetProjectTypes);

// Perform cleanup before copying new rules
async function performCleanup() {
    console.log(`\n=== Rule Cleanup Phase ===`);
    const deletedFiles = await ruleCleanupHandler.cleanupOrphanedRules(sourceBaseDir);
    
    if (deletedFiles.length > 0) {
        console.log(`\nDeleted ${deletedFiles.length} orphaned rule files:`);
        deletedFiles.forEach(file => console.log(`  - ${file}`));
    }
    
    return deletedFiles;
}

// Function to copy directory recursively
function copyDir(source, target) {
    if (!fs.existsSync(source)) {
        console.log(`DEBUG: Source directory does not exist: ${source}`);
        return;
    }

    console.log(`DEBUG: Copying directory from ${source} to ${target}`);
    fs.mkdirSync(target, { recursive: true });
    
    const entries = fs.readdirSync(source, { withFileTypes: true });
    
    for (const entry of entries) {
        const sourcePath = path.join(source, entry.name);
        const targetPath = path.join(target, entry.name);
        
        if (entry.isDirectory()) {
            copyDir(sourcePath, targetPath);
        } else if (entry.isFile()) {
            console.log(`DEBUG: Copying file ${sourcePath} to ${targetPath}`);
            fs.copyFileSync(sourcePath, targetPath);
            console.log(`Copied file: ${entry.name}`);
            
            // Verify the file was copied
            if (fs.existsSync(targetPath)) {
                console.log(`DEBUG: Verified ${targetPath} exists after copy`);
            } else {
                console.log(`ERROR: ${targetPath} does not exist after copy`);
            }
        }
    }
}

// Function to extract the target path from the project type structure
function getTargetPathFromProjectType(sourceProjectTypeDir) {
    // sourceProjectTypeDir is like: ../general/pathA/.cursor or ../general/docs/.cursor
    // We want to extract: pathA/.cursor or docs/.cursor
    
    // Find where the project type directory starts
    const normalizedPath = sourceProjectTypeDir.replace(/\\/g, '/');
    const parts = normalizedPath.split('/');
    
    // Look for the project type directory (we know it's after ai-rules or in our test case, after ..)
    let projectTypeIndex = -1;
    
    // In our case, the structure might be: ../general/pathA/.cursor
    // Find 'general' (or any project type directory name)
    for (let i = 0; i < parts.length; i++) {
        if (parts[i] === 'general' || parts[i] === 'react' || parts[i] === 'typescript' || parts[i] === 'nodejs' || parts[i] === 'api') {
            projectTypeIndex = i;
            break;
        }
    }
    
    // If we can't find by name, try to find based on pattern: look for the directory before .cursor that's not ai-rules
    if (projectTypeIndex === -1) {
        const cursorTestIndex = parts.findIndex(part => part === '.cursor');
        if (cursorTestIndex > 0) {
            // The project type should be somewhere before .cursor
            // Let's work backwards from .cursor to find a reasonable starting point
            for (let i = cursorTestIndex - 1; i >= 0; i--) {
                if (parts[i] !== 'ai-rules' && parts[i] !== '..' && parts[i] !== '') {
                    // Check if this looks like a project type directory
                    // by seeing if the next parts form a reasonable path
                    const potentialPath = parts.slice(i + 1, cursorTestIndex);
                    if (potentialPath.length > 0) {
                        projectTypeIndex = i;
                        break;
                    }
                }
            }
        }
    }
    
    if (projectTypeIndex >= 0) {
        const cursorTestIndex = parts.findIndex(part => part === '.cursor');
        if (cursorTestIndex > projectTypeIndex) {
            // Extract everything between projectType and .cursor
            const pathParts = parts.slice(projectTypeIndex + 1, cursorTestIndex);
            const extractedPath = pathParts.join(path.sep);
            
            console.log(`DEBUG: Project type index: ${projectTypeIndex}, parts: ${parts[projectTypeIndex]}`);
            console.log(`DEBUG: Path parts between project type and .cursor:`, pathParts);
            console.log(`DEBUG: Extracted target path from ${sourceProjectTypeDir}: ${extractedPath}`);
            
            // Return the path with .cursor appended
            return extractedPath ? path.join(extractedPath, '.cursor') : '.cursor';
        }
    }
    
    // Fallback
    console.log(`DEBUG: Could not extract path from ${sourceProjectTypeDir}, using fallback`);
    return '.cursor';
}

// Main execution function
async function main() {
    try {
        // Perform cleanup first if needed
        await performCleanup();
        
        console.log(`\n=== Rule Copy Phase ===`);
        
        // Copy rules for each matching project type
        let totalFilesCopied = 0;

        for (const projectType of targetProjectTypes) {
            console.log(`\nProcessing project type: ${projectType}`);
            
            // Look for the project type directory in the source
            const projectTypeDir = path.join(sourceBaseDir, projectType);
            
            if (!fs.existsSync(projectTypeDir)) {
                console.log(`DEBUG: Project type directory does not exist: ${projectTypeDir}`);
                continue;
            }
            
            console.log(`DEBUG: Found project type directory: ${projectTypeDir}`);
            
            // Find all .cursor directories within this project type
            function findCursorTestDirs(dir, relativePath = '') {
                const cursorTestDirs = [];
                
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        
                        if (entry.isDirectory()) {
                            if (entry.name === '.cursor') {
                                cursorTestDirs.push(fullPath);
                            } else {
                                // Recursively search subdirectories
                                cursorTestDirs.push(...findCursorTestDirs(fullPath, path.join(relativePath, entry.name)));
                            }
                        }
                    }
                } catch (error) {
                    console.log(`DEBUG: Error reading directory ${dir}:`, error.message);
                }
                
                return cursorTestDirs;
            }
            
            const cursorTestDirs = findCursorTestDirs(projectTypeDir);
            
            if (cursorTestDirs.length === 0) {
                console.log(`DEBUG: No .cursor directories found in ${projectTypeDir}`);
                continue;
            }
            
            console.log(`DEBUG: Found .cursor directories:`, cursorTestDirs);
            
            // Copy each .cursor directory to its appropriate location
            for (const cursorTestDir of cursorTestDirs) {
                const relativePath = getTargetPathFromProjectType(cursorTestDir);
                const targetPath = path.join(effectiveTargetBaseDir, relativePath);
                
                console.log(`DEBUG: Relative path from project type: ${relativePath}`);
                console.log(`DEBUG: Final target path: ${targetPath}`);
                console.log(`DEBUG: Copying .cursor directory from ${cursorTestDir} to ${targetPath}`);
                copyDir(cursorTestDir, targetPath);
                totalFilesCopied++;
            }
        }

        if (totalFilesCopied === 0) {
            console.log(`No rules found for repository ${targetRepo} with project types: ${targetProjectTypes.join(', ')}`);
        } else {
            console.log(`Successfully copied rules for repository: ${targetRepo} (${totalFilesCopied} .cursor directories)`);
        }
        
        console.log(`\n=== Summary ===`);
        console.log(`Repository: ${targetRepo}`);
        console.log(`Project types: ${targetProjectTypes.join(', ')}`);
        console.log(`Rules copied: ${totalFilesCopied} .cursor directories`);
        
    } catch (error) {
        console.error('Error during rule copy/cleanup process:', error);
        process.exit(1);
    }
}

// Run the main function
main(); 