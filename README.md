# Documentation to Cursor rules

A GitHub Action that automatically generates Cursor IDE rules from markdown documentation and distributes them to multiple repositories via Pull Requests.

## Overview

This action processes markdown files with special HTML comments and converts them into AI IDE rules (currenlty only cursor with `.mdc` files) that can be used for AI assistance. It then automatically creates Pull Requests in target repositories to keep ai rules synchronized with your documentation repos.

For now, only Cursor Rules are supported.

## Features

- 🔄 **Automatic Distribution**: Creates PRs in multiple target repositories
- 📝 **Markdown Processing**: Supports both `.md` and `.mdx` files
- 🏗️ **Multiple Rule Types**: `always`, `auto_attached`, `agent_requested`, `manual`, `excluded`
- 📁 **Hierarchical Structure**: Supports nested sections and custom paths
- 📋 **Table of Contents**: Auto-generates navigation rules
- ⚙️ **Configurable**: Flexible YAML configuration

## Roadmap
- add integrations for other AI rules (Windsurf, etc)
- optimize scripts to reduce action execution time

## Quick Start

### 1. Set Up GitHub Token

The action needs a GitHub token to create Pull Requests in target repositories.

#### Fine-grained Personal Access Token

1. Go to [GitHub Settings → Developer settings → Personal access tokens → Fine-grained tokens](https://github.com/settings/personal-access-tokens/new)
2. Select the repositories you want the action to access
3. Grant the following permissions:
   - **Contents**: Write
   - **Pull requests**: Write
4. Generate and copy the token

### 2. Add Token to Repository Secrets

1. Go to your repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `AI_RULES_DEFAULT_TOKEN`
4. Value: Paste your GitHub token
5. Click "Add secret"

#### Repository-Specific Tokens (Optional)

For organizations managing repositories across different GitHub organizations or requiring different access levels, you can configure repository-specific tokens:

1. **Create additional tokens** with access to specific repositories
2. **Add them in ai-rules-config.yml per repository** (see step 3 below)
3. **Reference in workflow** using environment variables (see step 4 below)

This allows you to:
- Use different tokens for different organizations
- Provide minimum required permissions per repository
- Rotate tokens independently
- Maintain access to repositories with different security requirements

### 3. Create Configuration File

Create `.github/ai-rules-config.yml` in your repository:

```yaml
# Rule generation settings
docsPath: 'docs'                    # Path to documentation files (default: '.')
defaultRuleType: 'agent_requested'  # Default type for rules
defaultRulePath: 'docs'             # Default path relative to target repository root (for the generated rules)
basePath: ''                        # Base path for all rules (can be overriden on a per-repo basis below)
defaultProjectTypes: ['general']    # Default project types if none specified
createTableOfContents: true         # Whether to generate a table of contents rule

# Export settings - which repositories get which projectType rules
# If you don't want to export all markdown file, just don't add the defaultProjectTypes value to exports
exports:
  'org/repo-name': ['project-type1', 'project-type2']

# Repository-specific GitHub tokens (optional)
# Maps repository names to environment variable names containing their tokens
# If not specified for a repo, falls back to GITHUB_TOKEN (from github-token input)
repositoryTokens:
  'private-org/sensitive-repo': 'PRIVATE_ORG_TOKEN'
  'partner-org/shared-repo': 'EXTERNAL_PARTNER_TOKEN'
  'legacy-org/old-system': 'LEGACY_SYSTEM_TOKEN'

# Branch strategy configuration (optional)
branchStrategy:
  # Frontend repos need rules in a specific subdirectory
  - repoTargets: ['org/frontend-app', 'org/react-components']
    mode: 'redo_branch_pr'
    branchName: 'update-ai-rules'
    targetBranch: 'main'
    basePath: 'tools/ai-config'  # Custom base path for these repos
  
  # Backend APIs use a different structure
  - repoTargets: ['org/api-gateway', 'org/user-service']
    mode: 'direct_commit'
    targetBranch: 'main'
    basePath: 'dev-tools'  # Rules go into dev-tools/ directory
    
  # Legacy repos that can't change their structure
  - repoTargets: ['org/legacy-system']
    mode: 'unique_branch_pr' 
    branchName: 'ai-rules-update'
    targetBranch: 'develop'
    basePath: ''  # No base path, rules go to repo root
    
  # Conservative cleanup - only removes explicitly deleted sections  
  - repoTargets: ['org/shared-components']
    mode: 'unique_branch_pr'
    branchName: 'update-ai-rules'
    targetBranch: 'main'
  
  # Per-repository configuration
  - repoTargets: ['org/repo1', 'org/repo2']  # Array of repositories
    mode: 'unique_branch_pr'
    branchName: 'update-ai-rules'
    targetBranch: 'main'
  
  # Single repository configuration
  - repoTargets: 'org/special-repo'  # Single repository
    mode: 'reuse_branch_pr'
    branchName: 'ai-rules-update'
    targetBranch: 'develop'
  
  # Default strategy for unspecified repositories
  - repoTargets: 'default'
    mode: 'unique_branch_pr'
    branchName: 'update-ai-rules'
    targetBranch: 'main'
    # basePath not specified = uses global basePath from main config
```

### 4. Create Workflow File

Create `.github/workflows/ai-rules.yml`:

```yaml
name: Generate AI Rules

on:
  push:
    branches: [ main ]
    paths:
      - '**/*.md'
      - '**/*.mdx'
      - '.github/ai-rules-config.yml'
  workflow_dispatch:  # Allow manual triggering

jobs:
  generate-rules:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Generate and Distribute Cursor Rules
        uses: Hikelio/doc-to-ai-rules@v0  # Or replace with the cloned repo
        with:
          github-token: ${{ secrets.AI_RULES_DEFAULT_TOKEN }}
        env:
          # Repository-specific tokens (optional)
          # These correspond to the repositoryTokens configuration in ai-rules-config.yml
          PRIVATE_ORG_TOKEN: ${{ secrets.PRIVATE_ORG_TOKEN }}
          EXTERNAL_PARTNER_TOKEN: ${{ secrets.EXTERNAL_PARTNER_TOKEN }}
          LEGACY_SYSTEM_TOKEN: ${{ secrets.LEGACY_SYSTEM_TOKEN }}
```

### 5. Create Documentation (or modify existing one for your needs)

Create markdown files in the directory specified by `docsPath` in your configuration (or the default location):

```markdown
# React Guidelines
<!-- ai-rules type="agent_requested" path="frontend" -->

Best practices for React development in our organization.

## Component Structure
<!-- ai-rules type="auto_attached" globs="*.{jsx,tsx}" -->

All components should follow this structure...

## State Management
<!-- ai-rules type="always" -->

Use Redux Toolkit for global state...
```

## Configuration Reference

### Rule Types

- **`always`**: Rules that are always applied
- **`auto_attached`**: Rules attached to specific file patterns
- **`agent_requested`**: Rules available on request with descriptions
- **`manual`**: Manually triggered rules
- **`excluded`**: Rules that are excluded from generation

### Branch Strategies

The action supports four different branch strategies to handle how changes are distributed to target repositories:

| Mode | Description | Required Permissions | Use Case |
|------|-------------|---------------------|----------|
| `unique_branch_pr` | Creates timestamped branch + PR | Contents: Write, PR: Write | Production repos needing review |
| `reuse_branch_pr` | Creates/resets branch to clean state + PR | Contents: Write, PR: Write | Single updating PR, clean slate |
| `redo_branch_pr` | Deletes old branch, creates new + PR | Contents: Write, PR: Write | Clean slate each time |
| `direct_commit` | **Commits directly to target branch** | **Contents: Write + Push to protected branch** | Internal/automated repos |

⚠️ **`direct_commit` requires push access to the target branch and bypasses branch protection rules.**
⚠️ **`direct_commit` is not recommended for now as this action is still in early development.**

### Repository-Specific Base Paths

You can configure different base paths for different repositories using the `basePath` option in branch strategies. This allows you to place AI rules in different directory structures depending on the target repository's conventions.

**Configuration:**

```yaml
# Global base path (fallback)
basePath: 'tools'

branchStrategy:
  # Frontend repositories use a specific tools directory
  - repoTargets: ['org/frontend-app', 'org/react-components']
    mode: 'redo_branch_pr'
    branchName: 'update-ai-rules'
    targetBranch: 'main'
    basePath: 'tools/ai-config'  # Rules go into tools/ai-config/
    
  # Backend APIs prefer dev-tools directory
  - repoTargets: ['org/api-gateway', 'org/user-service']
    mode: 'direct_commit'
    targetBranch: 'main'
    basePath: 'dev-tools'  # Rules go into dev-tools/
    
  # Legacy repos can't change structure - no base path
  - repoTargets: ['org/legacy-system']
    mode: 'unique_branch_pr'
    branchName: 'ai-rules-update'
    targetBranch: 'develop'
    basePath: ''  # Rules go to repository root
    
  # Default strategy uses global basePath
  - repoTargets: 'default'
    mode: 'unique_branch_pr'
    branchName: 'update-ai-rules'
    targetBranch: 'main'
    # basePath not specified = uses global basePath ('tools')
```

**Use Cases:**
- **Monorepos**: Place rules in specific service directories
- **Legacy Systems**: Work with existing directory structures
- **Team Conventions**: Match different teams' preferred file organization
- **Tool Integration**: Place rules where existing tooling expects them

**How It Works:**
- If `basePath` is specified in a branch strategy, it overrides the global `basePath`
- If not specified, falls back to the global `basePath` from the main configuration
- An empty string (`''`) means rules go to the repository root
- Paths are always relative and validated for security

### Rule Cleanup

The action automatically cleans up orphaned rules to keep target repositories synchronized with the current documentation. This ensures that when sections are removed from documentation, the corresponding rules are also removed from target repositories.

**How Cleanup Works:**
- Uses the `ai-rules-project` frontmatter to identify rules managed by this action
- Only affects rules with project types configured for the target repository
- Safe for multi-repository setups - won't delete rules from other doc repos as long as projectType do not overlap
- Automatically removes any rules that does not exist in the current generation

### HTML Comment Syntax

The AI rules system uses HTML comments with a simple, consistent attribute syntax:

```markdown
<!-- ai-rules type="rule_type" path="custom/path" globs="*.tsx,*.jsx" description="Custom description" projectTypes='["type1", "type2"]' -->
```

**Key Features:**
- **Simple Attributes**: Common attributes like `globs` and `description` are direct, no JSON needed
- **JSON Only When Needed**: Complex attributes like `projectTypes` use JSON arrays
- **Standard Parsing**: Clear, predictable syntax with good error handling

**Quick Examples:**

```markdown
<!-- Basic rule -->
<!-- ai-rules type="always" -->

<!-- Rule with file patterns -->
<!-- ai-rules type="auto_attached" globs="*.jsx,*.tsx" -->

<!-- Rule with custom description -->
<!-- ai-rules type="agent_requested" description="Guidelines for React components" -->

<!-- Rule with project types -->
<!-- ai-rules type="agent_requested" projectTypes='["react", "frontend", "typescript"]' -->

<!-- Complex rule with multiple attributes -->
<!-- ai-rules type="auto_attached" path="components" globs="*.jsx,*.tsx" description="React component guidelines" projectTypes='["react"]' -->
```

## Documentation Format and Syntax

The generator processes markdown files and looks for special HTML comments to configure rules. Each section can have its own configuration and content.

### Writing Documentation with AI Rules

Best practice is to place configuration comments (`ai-rules` tags) immediately after the section title:

```markdown
## Introduction
<!-- ai-rules type="always" path="intro" projectTypes='["react", "client-portal"]' -->
Content here...

## TypeScript Guidelines
<!-- ai-rules type="auto_attached" globs="*.ts,*.js" -->
More content...

### React Components
<!-- ai-rules type="agent_requested" description="Custom description" -->
Content about components...

## Unified Section
<!-- ai-rules type="always" unifySubsections="true" -->
This section will include all its subsections as content rather than separate sections.

### Subsection
This content will be part of the parent section instead of being a separate rule.
```

### Path Construction

The final path for each rule is constructed by combining:
1. `basePath` (from config, basePath or repository-specific via branchStrategy)
2. Section's configured `path` (from ai-rules tag) or `defaultRulePath`
3. `.cursor/rules/` (constant)
4. Section-specific folder structure

For example, with this configuration and section:
```yaml
basePath: 'base/path'
defaultRulePath: 'default'
```

```markdown
<!-- ai-rules type="agent_requested" path="custom/path" -->
# My Section
## Subsection
```

The files would be generated at:
- `base/path/custom/path/.cursor/rules/my_section.mdc`
- `base/path/custom/path/.cursor/rules/my_section/subsection.mdc`

### Table of Contents Generation

When `createTableOfContents` is enabled, the tool generates a "table_of_contents" rule for each unique path in your documentation. Each table of contents:
- Lists all sections and their subsections in that specific path
- Uses indentation to show the nesting level
- Is generated with `type: "always"` to ensure it's readily available
- Is placed in the same path as the sections it lists

Example output:
```markdown
# Table of Contents

- react_components
  - usage
  - best_practices
- api_guidelines
  - authentication
  - endpoints
```

### Rule Types and Their Frontmatter

Each rule type generates a specific frontmatter structure:

1. **always**
   ```yaml
   ---
   alwaysApply: true
   ---
   ```

2. **auto_attached**
   ```yaml
   ---
   globs: [specified globs]
   alwaysApply: false
   ---
   ```

3. **agent_requested**
   ```yaml
   ---
   description: [section name or custom description]
   alwaysApply: false
   ---
   ```

4. **manual**
   ```yaml
   ---
   alwaysApply: false
   ---
   ```

5. **excluded**
   When a section is marked as "excluded", it and all its subsections will be completely skipped during rule generation. This is useful for sections that should not be processed as rules.

### Configuration Options Reference

In HTML comments, you can use these attributes:
- `type`: Rule type (see above)
- `path`: Output path for the rule file (defaults to `defaultRulePath`)
- `globs`: File patterns for `auto_attached` rules (gitignore-style, e.g., `"*.jsx,*.tsx"`)
- `description`: Custom description for `agent_requested` rules (optional, defaults to section name)
- `projectTypes`: JSON array of project types this section applies to (e.g., `'["react", "typescript"]'`)
- `unifySubsections`: When set to "true", treats all subsections as content rather than separate rules

### Section Unification

The `unifySubsections` option allows you to treat a section and all its subsections as a single unit:

```markdown
## Main Section
<!-- ai-rules type="always" unifySubsections="true" -->
Main content...

### Subsection 1
This content will be part of the main section.

#### Deeper Subsection
This will also be part of the main section.
```

When `unifySubsections` is true:
- All subsection headers will be included in the parent section's content
- All content from subsections will be treated as part of the parent section
- No separate rule files are generated for subsections
- Any `ai-rules` tags within unified subsections are ignored

### Project Types and Inheritance

Rules can be tagged with project types to indicate which kind of projects they apply to:

```markdown
## React Guidelines
<!-- ai-rules type="agent_requested" projectTypes='["react", "frontend", "typescript"]' -->
This section applies to react, frontend, and typescript projects.

### Component Structure
<!-- ai-rules type="auto_attached" globs="*.jsx,*.tsx" -->
This subsection inherits the parent's project types unless overridden.
```

Project types inherit from parent sections if not specified. If no project type is specified in the section or inherited, `defaultProjectTypes` from the config is used.

### Configuration Merging

Multiple configurations within the same section are merged together:

```markdown
## Section
<!-- ai-rules type="always" -->
<!-- ai-rules path="custom/path" -->
<!-- ai-rules description="Custom description" -->
All three configurations are merged into one rule.
```

## Troubleshooting

### Authentication Issues

If you see "Authentication failed" errors:

1. **Check token permissions**: Ensure your token has `repo` scope or appropriate fine-grained permissions
2. **Verify token is set**: Check that `AI_RULES_DEFAULT_TOKEN` secret exists and is not empty
3. **Repository access**: Ensure the token has access to target repositories
4. **Token expiration**: Check if your token has expired

### Common Issues

**"Config file does not exist"**
- Ensure `.github/ai-rules-config.yml` exists and is committed to your repository

**"No changes for repository"**
- The target repository might already have the latest rules
- Check if your documentation changes actually generate different rules

**"Module not found" errors**
- This usually indicates a Docker build issue - check the action logs

## Action Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `github-token` | GitHub token with repository access | Yes | - |
| `config-path` | Path to ai-rules-config.yml | No | `.github/ai-rules-config.yml` |
| `branch-name` | Branch name for PRs | No | `update-ai-rules` |
| `commit-message` | Commit message | No | `Update Cursor rules from documentation` |
| `pr-title` | Pull Request title | No | `Update Cursor rules` |
| `pr-body` | Pull Request body | No | `Automatically generated Cursor rules from documentation` |

**Note:** Repository-specific tokens are passed as environment variables in the workflow, not as action inputs.

## Examples

### Basic Setup

```yaml
# .github/ai-rules-config.yml
docsPath: '.'  # Path to documentation files
defaultRuleType: 'agent_requested'
exports:
  'myorg/frontend': ['react']
  'myorg/backend': ['nodejs']
```

### Advanced Setup with Repository-Specific Tokens

```yaml
# .github/ai-rules-config.yml
docsPath: 'documentation'  # Custom documentation directory
defaultRuleType: 'agent_requested'
defaultRulePath: 'docs'
basePath: 'shared'
createTableOfContents: true
defaultProjectTypes: ['general', 'typescript']

exports:
  'myorg/web-app': ['react', 'typescript', 'frontend']
  'external-org/shared-lib': ['typescript', 'library']
  'partner-org/integration': ['api', 'typescript']

repositoryTokens:
  'external-org/shared-lib': 'AI_RULES_EXTERNAL_ORG_TOKEN'
  'partner-org/integration': 'PARTNER_TOKEN'
  # myorg/web-app uses default github-token token set in action workflow

branchStrategy:
  - repoTargets: ['external-org/shared-lib']
    mode: 'unique_branch_pr'  # More careful with external repos
    branchName: 'update-ai-rules'
    targetBranch: 'main'
  - repoTargets: 'default'
    mode: 'reuse_branch_pr'
    branchName: 'ai-rules-update'
    targetBranch: 'develop'
```

## Roadmap

- improve performance to reduce Github Action runtime (lot of easy improvements not done if initial version)
- add support for Windsurf rules, and others

## License

MIT License - see LICENSE file for details.