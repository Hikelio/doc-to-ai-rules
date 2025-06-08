const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const ConfigParser = require('./configParser');
const { log } = require('./utils');

class FileHandler {
    static async readMdxFile(filePath) {
        const content = await fs.promises.readFile(filePath, 'utf8');
        return matter(content);
    }

    static async writeRuleFiles(rules, config, sectionNames) {
        // Write index file
        await this.writeJsonFile('ai_rules.json', { rules });

        // Write individual rule files
        for (const rule of rules) {
            log('rule config:', rule.config);
            // Use effectiveConfig if available (for table of contents rules), otherwise use regular config
            const ruleConfig = rule.effectiveConfig || rule.config || {};
            await this.writeNestedRules(rule.name, {
                config: ruleConfig,
                content: rule.content,
                sections: rule.sections
            }, null, config, [], sectionNames);  // Pass sectionNames separately
        }
    }

    static generateDescription(name, sectionPath, sectionNames, description, parentDescription = '') {
        // Find all occurrences of this section name using formatted version for lookup
        const formattedName = ConfigParser.formatTitle(name);
        const occurrences = sectionNames[formattedName] || [];
        log('Occurrences of ', name, ':', occurrences);

        const nameWithDesc = name + (description ? `: ${description}` : '');
        // If name is unique across all sections, just use the name
        if (occurrences.length <= 1) {
            return nameWithDesc;
        }

        // Not unique, extract the parent's unique path (up to and including "> parentName")
        const parentName = sectionPath[sectionPath.length - 1];
        const searchText = ` > ${parentName}`;
        const parentPathEndIndex = parentDescription.indexOf(searchText);
        const parentUniquePath = parentPathEndIndex !== -1 
            ? parentDescription.substring(0, parentPathEndIndex + searchText.length)
            : parentDescription;

        // If custom description is provided, use it
        const finalDescription = `${parentUniquePath} > ${nameWithDesc}`;

        // Prepend parent's unique path
        return finalDescription;
    }

    static async writeNestedRules(sectionName, section, parentConfig, config, sectionPath, sectionNames, parentDescription = '') {
        log('Parent config:', parentConfig);
        log('Writing nested rules for:', sectionName, 'with config:', section.config);

        // Format the filename while keeping original name for display
        const formattedFileName = ConfigParser.formatTitle(sectionName);

        // Inherit from parent config, then apply section's own config
        const effectiveConfig = ConfigParser.calculateEffectiveConfig(section, parentConfig, config);

        // Skip processing this section and its subsections if type is "excluded"
        if (effectiveConfig.type === 'excluded') {
            log(`Skipping excluded section: ${sectionName}`);
            return;
        }

        // Generate the current section's description and the hierarchical path for children
        let hierarchicalPathForChildren = '';
        if (effectiveConfig.type === 'agent_requested') {
            // Generate this section's description for frontmatter
            const currentSectionDescription = this.generateDescription(
                sectionName,
                sectionPath,
                sectionNames,
                effectiveConfig.description,
                parentDescription
            );
            
            // For children, extract the hierarchical path part (without custom description)
            // This is the part before any custom description (before the last ":")
            const colonIndex = currentSectionDescription.lastIndexOf(':');
            if (colonIndex !== -1 && effectiveConfig.description) {
                // Has custom description, extract the path part
                hierarchicalPathForChildren = currentSectionDescription.substring(0, colonIndex).trim();
            } else {
                // No custom description, use the full generated description
                hierarchicalPathForChildren = currentSectionDescription;
            }
        } else {
            // For non-agent_requested sections, build basic hierarchical path
            if (parentDescription) {
                hierarchicalPathForChildren = `${parentDescription} > ${sectionName}`;
            } else {
                hierarchicalPathForChildren = sectionName;
            }
        }

        // Create rules for each project type separately
        const projectTypes = effectiveConfig.projectTypes || [];
        
        for (const projectType of projectTypes) {
            await this.writeRuleForProjectType(
                sectionName,
                section,
                effectiveConfig,
                config,
                sectionPath,
                sectionNames,
                parentDescription,
                projectType,
                formattedFileName
            );
        }

        // Process inner sections
        if (section.sections) {
            for (const [subsectionName, innerSection] of Object.entries(section.sections)) {
                // For subsections, add the current section name to the path
                const isTopLevel = sectionPath.length === 0;
                const newSectionPath = isTopLevel ? 
                    [sectionName] :  // Start the path with the top-level section name
                    [...sectionPath, sectionName];  // Add current section to existing path

                // Pass the clean hierarchical path (without custom descriptions) to children
                await this.writeNestedRules(
                    subsectionName,
                    innerSection,
                    effectiveConfig,
                    config,
                    newSectionPath,
                    sectionNames,
                    hierarchicalPathForChildren  // Pass clean hierarchical path
                );
            }
        }
    }

    static async writeRuleForProjectType(sectionName, section, effectiveConfig, config, sectionPath, sectionNames, parentDescription, projectType, formattedFileName) {
        // Build the rule path based on section hierarchy
        const isTopLevel = sectionPath.length === 0;
        const rulesPath = isTopLevel ? 
            path.join('.cursor', 'rules') :
            path.join('.cursor', 'rules', ...sectionPath.map(ConfigParser.formatTitle));

        // New structure: /tmp/ai-rules/projectType/basePath/rulePath/.cursor/rules/
        let rulePath;
        if (path.isAbsolute(effectiveConfig.path)) {
            // If path is absolute, use it directly
            rulePath = path.join(
                projectType,
                config.basePath || '',
                effectiveConfig.path,
                rulesPath,
                `${formattedFileName}.mdc`
            );
        } else {
            // If path is relative, resolve from current directory
            rulePath = path.join(
                process.cwd(),
                projectType,
                config.basePath || '',
                effectiveConfig.path,
                rulesPath,
                `${formattedFileName}.mdc`
            );
        }

        // Create frontmatter based on rule type
        const frontmatter = {
            'ai-rules-project': projectType  // Add project type for cleanup identification
        };
        
        switch(effectiveConfig.type) {
            case 'always':
                frontmatter.alwaysApply = true;
                break;
            case 'auto_attached':
                frontmatter.globs = effectiveConfig.globs || '';
                frontmatter.alwaysApply = false;
                break;
            case 'agent_requested':
                // Generate description using parent's description
                frontmatter.description = this.generateDescription(
                    sectionName,
                    sectionPath,
                    sectionNames,
                    effectiveConfig.description,
                    parentDescription
                );
                frontmatter.alwaysApply = false;
                break;
            case 'manual':
                frontmatter.alwaysApply = false;
                break;
        }

        // Build content including section references
        let content = [];
        
        // Add main content if exists
        if (section.content && section.content.length > 0) {
            content.push(...section.content);
        }

        // Add section references where they belong
        if (section.sections) {
            for (const [subsectionName, innerSection] of Object.entries(section.sections)) {
                content.push(`(subsection: '${subsectionName}')`);
            }
        }

        // Combine frontmatter and content
        const frontmatterEntries = Object.entries(frontmatter).map(([key, value]) => {
            // Properly format values for YAML frontmatter
            if (typeof value === 'boolean') {
                return `${key}: ${value}`;
            } else if (typeof value === 'string') {
                return `${key}: "${value}"`;
            } else {
                return `${key}: ${value}`;
            }
        });
        
        const fileContent = `---
${frontmatterEntries.join('\n')}
---
${content.join('\n')}`;

        await this.writeMdcFile(rulePath, fileContent);
    }

    static async writeJsonFile(filePath, content) {
        const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
        log('Creating directory:', path.dirname(absolutePath));
        await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
        log('Writing file:', absolutePath);
        await fs.promises.writeFile(
            absolutePath,
            JSON.stringify(content, null, 2)
        );
    }

    static async writeMdcFile(filePath, content) {
        log('Creating directory:', path.dirname(filePath));
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        log('Writing file:', filePath);
        await fs.promises.writeFile(filePath, content);
    }

    static async findMarkdownFiles(directory) {
        const files = await fs.promises.readdir(directory, { withFileTypes: true });
        const markdownFiles = [];

        for (const file of files) {
            const fullPath = path.join(directory, file.name);
            if (file.isDirectory()) {
                markdownFiles.push(...await this.findMarkdownFiles(fullPath));
            } else if (file.name.endsWith('.mdx') || file.name.endsWith('.md')) {
                markdownFiles.push(fullPath);
            }
        }

        return markdownFiles;
    }
}

module.exports = FileHandler; 