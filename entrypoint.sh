#!/bin/sh -l

set -e

# Configure git
git config --global user.name "GitHub Action"
git config --global user.email "action@github.com"

# Create a new directory for processing
mkdir -p /tmp/ai-rules
cd /tmp/ai-rules

# Clone the source repository (we're already in it via actions/checkout)
# Use cp with -a flag to copy all files including hidden ones
cp -a $GITHUB_WORKSPACE/. .

# [DEBUG]  Show what files are available
echo "=== [DEBUG]  Files in /tmp/ai-rules ==="
ls -la
echo "=== [DEBUG]  Looking for config file at: $CONFIG_PATH ==="
ls -la "$CONFIG_PATH" || echo "Config file not found at $CONFIG_PATH"

# Run the rule generator from the working directory where files are located
cd /tmp/ai-rules
node /app/generateAiRules.js "$CONFIG_PATH"

# Read the config file to get target repositories
CONFIG_FILE="$CONFIG_PATH"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "[ERROR] ❗  Config file not found at $CONFIG_FILE"
    exit 1
fi

# Process each target repository - run from /app where dependencies are available
cd /app
for repo in $(node -e "
    const yaml = require('js-yaml');
    const fs = require('fs');
    const config = yaml.load(fs.readFileSync('/tmp/ai-rules/$CONFIG_FILE', 'utf8'));
    Object.keys(config.exports || {}).forEach(repo => console.log(repo));
"); do
    echo "Processing repository: $repo"
    
    # Get repository-specific token if configured, otherwise use default
    # Make sure to run this from /app directory where dependencies are available
    cd /app
    REPO_TOKEN=$(node -e "
        const yaml = require('js-yaml');
        const fs = require('fs');
        const config = yaml.load(fs.readFileSync('/tmp/ai-rules/$CONFIG_FILE', 'utf8'));
        const repoTokens = config.repositoryTokens || {};
        const tokenEnvVar = repoTokens['$repo'];
        if (tokenEnvVar) {
            console.log(process.env[tokenEnvVar] || '');
        } else {
            console.log(process.env.GITHUB_TOKEN || '');
        }
    ")
    
    # Get the token environment variable name for logging
    # Make sure to run this from /app directory where dependencies are available
    cd /app
    TOKEN_ENV_VAR=$(node -e "
        const yaml = require('js-yaml');
        const fs = require('fs');
        const config = yaml.load(fs.readFileSync('/tmp/ai-rules/$CONFIG_FILE', 'utf8'));
        const repoTokens = config.repositoryTokens || {};
        const tokenEnvVar = repoTokens['$repo'];
        console.log(tokenEnvVar || 'GITHUB_TOKEN');
    ")
    
    # [DEBUG]  Check if token is available (without exposing it)
    if [ -z "$REPO_TOKEN" ]; then
        echo "[ERROR] ❗  No token available for repository $repo"
        echo "Expected token in environment variable: $TOKEN_ENV_VAR"
        exit 1
    else
        echo "[DEBUG]  Using token from $TOKEN_ENV_VAR for repository $repo (length: ${#REPO_TOKEN})"
    fi
    
    # Test token access to the repository
    echo "[DEBUG]  Testing token access to repository $repo"
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: token $REPO_TOKEN" \
        -H "Accept: application/vnd.github.v3+json" \
        "https://api.github.com/repos/$repo")
    
    if [ "$HTTP_STATUS" = "200" ]; then
        echo "[DEBUG]  Token has access to repository $repo"
    else
        echo "[ERROR] ❗  Token does not have access to repository $repo (HTTP $HTTP_STATUS)"
        echo "Please check:"
        echo "1. The repository exists and is accessible"
        echo "2. The token ($TOKEN_ENV_VAR) has the required permissions"
        echo "3. The token is not expired"
        continue
    fi
    
    # Get branch strategy for this repository
    echo "[DEBUG]  Getting branch strategy for repository $repo"
    # Make sure to run this from /app directory where dependencies are available
    cd /app
    STRATEGY_JSON=$(node -e "
        const BranchStrategyHandler = require('./branchStrategyHandler');
        const handler = new BranchStrategyHandler('/tmp/ai-rules/$CONFIG_FILE');
        const strategy = handler.getStrategyForRepo('$repo');
        handler.validateStrategy(strategy);
        console.log(JSON.stringify(strategy));
    ")
    
    if [ $? -ne 0 ]; then
        echo "[ERROR] ❗  Failed to get or validate branch strategy for $repo"
        continue
    fi
    
    echo "[DEBUG]  Branch strategy for $repo: $STRATEGY_JSON"
    
    # Extract strategy details
    cd /app
    MODE=$(echo "$STRATEGY_JSON" | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).mode)")
    TARGET_BRANCH=$(echo "$STRATEGY_JSON" | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).targetBranch)")
    BRANCH_NAME_TEMPLATE=$(echo "$STRATEGY_JSON" | node -e "console.log(JSON.parse(require('fs').readFileSync(0, 'utf8')).branchName || '')")
    
    echo "[DEBUG]  Mode: $MODE, Target Branch: $TARGET_BRANCH, Branch Template: $BRANCH_NAME_TEMPLATE"
    
    # Generate actual branch name based on strategy
    cd /app
    ACTUAL_BRANCH_NAME=$(node -e "
        const BranchStrategyHandler = require('./branchStrategyHandler');
        const handler = new BranchStrategyHandler('/tmp/ai-rules/$CONFIG_FILE');
        const strategy = JSON.parse('$STRATEGY_JSON');
        console.log(handler.generateBranchName(strategy));
    ")
    
    echo "[DEBUG]  Generated branch name: $ACTUAL_BRANCH_NAME"
    
    # Create temporary directory for this repo
    REPO_DIR="/tmp/repos/$repo"
    mkdir -p "$REPO_DIR"
    cd "$REPO_DIR"
    
    # Clone the target repository
    echo "[DEBUG]  Attempting to clone https://github.com/$repo.git"
    git clone "https://x-access-token:$REPO_TOKEN@github.com/$repo.git" .
    
    # Handle different branch strategies
    case "$MODE" in
        "direct_commit")
            echo "[DEBUG]  Using direct_commit mode - checking out target branch: $TARGET_BRANCH"
            if ! git checkout "$TARGET_BRANCH" 2>/dev/null; then
                echo "[ERROR] ❗  Target branch '$TARGET_BRANCH' does not exist in repository $repo"
                echo "This could be because:"
                echo "1. The repository is empty (no branches created yet)"
                echo "2. The branch name is incorrect"
                echo "3. The default branch has a different name"
                echo "Please ensure the target branch exists or create it first."
                continue
            fi
            ;;
        
        "redo_branch_pr")
            echo "[DEBUG]  Using redo_branch_pr mode - deleting old branch if exists: $ACTUAL_BRANCH_NAME"
            # Check if branch exists remotely and delete it
            if git ls-remote --heads origin "$ACTUAL_BRANCH_NAME" | grep -q "$ACTUAL_BRANCH_NAME"; then
                echo "[DEBUG]  Deleting existing remote branch: $ACTUAL_BRANCH_NAME"
                git push origin --delete "$ACTUAL_BRANCH_NAME" || echo "WARNING: Could not delete remote branch"
            fi
            # Create fresh branch
            git checkout -b "$ACTUAL_BRANCH_NAME"
            ;;
        
        "reuse_branch_pr")
            echo "[DEBUG]  Using reuse_branch_pr mode - creating/checking out branch: $ACTUAL_BRANCH_NAME"
            # Always start from target branch to avoid accumulating old changes from closed PRs
            git checkout "$TARGET_BRANCH"
            if git ls-remote --heads origin "$ACTUAL_BRANCH_NAME" | grep -q "$ACTUAL_BRANCH_NAME"; then
                echo "[DEBUG]  Branch exists remotely, creating local branch and resetting to $TARGET_BRANCH"
                git checkout -B "$ACTUAL_BRANCH_NAME"
            else
                echo "[DEBUG]  Creating new branch: $ACTUAL_BRANCH_NAME"
                git checkout -b "$ACTUAL_BRANCH_NAME"
            fi
            ;;
        
        "unique_branch_pr")
            echo "[DEBUG]  Using unique_branch_pr mode - creating unique branch: $ACTUAL_BRANCH_NAME"
            git checkout -b "$ACTUAL_BRANCH_NAME"
            ;;
        
        *)
            echo "[ERROR] ❗  Unknown branch strategy mode: $MODE"
            continue
            ;;
    esac
    
    # Copy generated rules for this repository - run from /app where dependencies are
    cd /app
    
    # With the new structure, we don't need to find individual .cursor directories
    # Instead, we pass the base directory and let copyRulesToRepo.js handle project type filtering
    echo "[DEBUG]  Copying rules for repository $repo using new project-type structure"
    
    # Change to target repository directory so relative paths work correctly
    cd "$REPO_DIR"
    
    # Copy rules using the new project-type-based approach
    echo "[DEBUG]  Generated .mdc files to be copied from /tmp/ai-rules:"
    find /tmp/ai-rules -type f -name "*.mdc" || echo "No .mdc files found to copy"
    echo "[DEBUG]  Generated .cursor directories to be copied from /tmp/ai-rules:"
    find /tmp/ai-rules -name ".cursor" -type d || echo "No .cursor directories found to copy"
    echo "[DEBUG]  Calling copyRulesToRepo.js with base directory: /tmp/ai-rules"
    node /app/copyRulesToRepo.js "$repo" "/tmp/ai-rules/$CONFIG_FILE" "/tmp/ai-rules" "."
    
    # Go back to repo directory to check for changes
    cd "$REPO_DIR"
    
    # [DEBUG]  Show what files were copied
    echo "[DEBUG]  Files in target repository after copying:"
    find . -type f -name "*.mdc" || echo "No .mdc files found"
    echo "[DEBUG]  Looking for .cursor directory:"
    find . -name ".cursor" -type d || echo "No .cursor directory found"
    echo "[DEBUG]  Git status:"
    git status --porcelain
    
    # Check if there are changes (including untracked files)
    if [ -z "$(git status --porcelain)" ]; then
        echo "No changes for repository: $repo"
        continue
    fi
    
    echo "Changes detected! Proceeding with commit and push/PR creation."
    
    # Commit changes
    git add .
    git commit -m "$COMMIT_MESSAGE"
    
    # Handle push and PR creation based on strategy
    case "$MODE" in
        "direct_commit")
            echo "[DEBUG]  Direct commit mode - pushing directly to $TARGET_BRANCH"
            git push origin "$TARGET_BRANCH"
            echo "Successfully pushed changes directly to $TARGET_BRANCH for repository: $repo"
            ;;
        
        "reuse_branch_pr")
            echo "[DEBUG]  Force push PR mode - force pushing to $ACTUAL_BRANCH_NAME"
            git push --force-with-lease origin "$ACTUAL_BRANCH_NAME"
            
            # Check for existing PR and update or create new one
            cd /app
            node -e "
                const BranchStrategyHandler = require('./branchStrategyHandler');
                const handler = new BranchStrategyHandler('/tmp/ai-rules/$CONFIG_FILE');
                
                (async () => {
                    try {
                        const existingPR = await handler.findExistingPR('$repo', '$ACTUAL_BRANCH_NAME', '$REPO_TOKEN');
                        
                        if (existingPR) {
                            console.log('[DEBUG]  Updating existing PR #' + existingPR.number);
                            await handler.updatePR('$repo', existingPR.number, '$PR_TITLE', '$PR_BODY', '$REPO_TOKEN');
                        } else {
                            console.log('[DEBUG]  Creating new PR');
                            await handler.createPR('$repo', '$PR_TITLE', '$PR_BODY', '$ACTUAL_BRANCH_NAME', '$TARGET_BRANCH', '$REPO_TOKEN');
                        }
                    } catch (error) {
                        console.error('Error handling PR:', error.message);
                        process.exit(1);
                    }
                })();
            "
            ;;
        
        "redo_branch_pr"|"unique_branch_pr")
            echo "[DEBUG]  Creating new branch and PR for $ACTUAL_BRANCH_NAME"
            git push origin "$ACTUAL_BRANCH_NAME"
            
            # Create new Pull Request
            cd /app
            node -e "
                const BranchStrategyHandler = require('./branchStrategyHandler');
                const handler = new BranchStrategyHandler('/tmp/ai-rules/$CONFIG_FILE');
                
                (async () => {
                    try {
                        await handler.createPR('$repo', '$PR_TITLE', '$PR_BODY', '$ACTUAL_BRANCH_NAME', '$TARGET_BRANCH', '$REPO_TOKEN');
                    } catch (error) {
                        console.error('Error creating PR:', error.message);
                        process.exit(1);
                    }
                })();
            "
            ;;
    esac
    
    echo "Successfully processed repository: $repo with strategy: $MODE"
done 