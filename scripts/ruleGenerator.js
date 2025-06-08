const FileHandler = require('./fileHandler');
const MarkdownParser = require('./markdownParser');
const ConfigParser = require('./configParser');
const { log } = require('./utils');

const DEFAULT_CONFIG = {
    // Rule generation settings
    docsPath: '.',  // Default path to documentation files
    defaultRuleType: 'agent_requested',  // Default rule type if not specified
    defaultRulePath: '',   // Default path relative to repository root
    basePath: '',  // Base path that cannot be overridden
    defaultProjectTypes: ['general'],    // Default project types if none specified
    createTableOfContents: true,  // Whether to generate a table of contents rule
};

class RuleGenerator {
    constructor(docsPath, config = {}) {
        this.docsPath = docsPath;
        this.config = {
            ...DEFAULT_CONFIG,
            ...config
        };
        // Initialize section names map
        this.sectionNames = {};
    }

    collectSectionNames(sections, currentPath = []) {
        log('\nCollecting section names for path:', currentPath);
        Object.entries(sections).forEach(([title, section]) => {
            const name = ConfigParser.formatTitle(title);
            log(`\nProcessing section "${name}":`, {
                currentPath,
                existingPaths: this.sectionNames[name] || []
            });

            if (!this.sectionNames[name]) {
                this.sectionNames[name] = [];
            }
            
            // Store the full hierarchical path for this section
            this.sectionNames[name].push([...currentPath]);
            log(`After adding path for "${name}":`, {
                allPaths: this.sectionNames[name]
            });

            if (section.sections) {
                this.collectSectionNames(section.sections, [...currentPath, title]);  // Use original title for path
            }
        });
    }

    generateTableOfContents(rules) {
        // Group rules by project type and path using effectiveConfig
        const rulesByProjectTypeAndPath = {};
        
        const collectRulesForProjectTypeAndPath = (section, isTopLevel = true) => {
            const path = section.effectiveConfig.path;
            const projectTypes = section.effectiveConfig.projectTypes || [];
            
            // Add section to each of its project types
            projectTypes.forEach(projectType => {
                const key = `${projectType}:${path}`;
                
                if (!rulesByProjectTypeAndPath[key]) {
                    rulesByProjectTypeAndPath[key] = [];
                }
                
                // Only add if it's top-level or has a different path than its parent
                if (isTopLevel) {
                    rulesByProjectTypeAndPath[key].push(section);
                }
            });

            // Process subsections
            if (section.sections) {
                Object.entries(section.sections).forEach(([name, subsection]) => {
                    const subsectionPath = subsection.effectiveConfig.path;
                    // If subsection has a different path, treat it as a top-level section for that path
                    const isTopLevelForPath = subsectionPath !== path;
                    collectRulesForProjectTypeAndPath(subsection, isTopLevelForPath);
                });
            }
        };

        // Process rules and their subsections
        rules.forEach(rule => collectRulesForProjectTypeAndPath(rule, true));

        // Generate a table of contents for each project type and path combination
        const tocRules = [];
        Object.entries(rulesByProjectTypeAndPath).forEach(([key, pathRules]) => {
            const [projectType, path] = key.split(':');
            let content = ['# Table of Contents\n'];

            const addSection = (section, level = 0) => {
                const indent = '  '.repeat(level);
                content.push(`${indent}- ${section.name}`);

                // Add subsections recursively, but only if they belong to the same path and project type
                if (section.sections) {
                    Object.entries(section.sections).forEach(([name, subsection]) => {
                        const subsectionProjectTypes = subsection.effectiveConfig.projectTypes || [];
                        if (subsection.effectiveConfig.path === path && 
                            subsectionProjectTypes.includes(projectType)) {
                            addSection(subsection, level + 1);
                        }
                    });
                }
            };

            pathRules.forEach(rule => {
                const ruleProjectTypes = rule.effectiveConfig.projectTypes || [];
                if (rule.effectiveConfig.path === path && ruleProjectTypes.includes(projectType)) {
                    addSection(rule);
                }
            });

            // Only create a table of contents if there are rules in this path for this project type
            if (content.length > 1) {
                tocRules.push({
                    name: 'table_of_contents',
                    description: `Complete hierarchy of rules in ${path || 'root'} for ${projectType}`,
                    content,
                    sections: {},
                    config: {
                        type: 'always',
                        path
                    },
                    effectiveConfig: {
                        type: 'always',
                        path,
                        projectTypes: [projectType]  // TOC belongs to specific project type
                    }
                });
            }
        });

        return tocRules;
    }

    async generateRules() {
        // Get all markdown files in the directory
        const markdownFiles = await FileHandler.findMarkdownFiles(this.docsPath);
        
        // Process each file and collect all sections
        const allSections = {};
        for (const file of markdownFiles) {
            const content = await FileHandler.readMdxFile(file);
            const sections = MarkdownParser.extractSections(content.content);
            
            // Collect section names for this file
            this.collectSectionNames(sections);
            
            // Merge sections from this file into the complete structure
            Object.assign(allSections, sections);
        }

        // Convert sections into rules with effective configs
        const processSection = (title, section, parentConfig = null) => {
            const effectiveConfig = ConfigParser.calculateEffectiveConfig(section, parentConfig, this.config);
            
            // Validate the effective configuration for incompatible options
            ConfigParser.validateEffectiveConfiguration(effectiveConfig, title);
            
            const rule = {
                name: title,
                description: section.config.description,
                content: section.content || [],
                sections: {},
                config: section.config || {},  // Original config
                effectiveConfig  // Add effective config
            };

            // Process subsections
            if (section.sections) {
                Object.entries(section.sections).forEach(([subTitle, subSection]) => {
                    rule.sections[subTitle] = processSection(subTitle, subSection, effectiveConfig);
                });
            }

            return rule;
        };

        // Convert each H1 section into a rule with effective configs
        const rules = Object.entries(allSections).map(([title, section]) => 
            processSection(title, section)
        );

        // Generate table of contents rules if enabled
        if (this.config.createTableOfContents) {
            const tocRules = this.generateTableOfContents(rules);
            rules.unshift(...tocRules);
        }

        log('----Section names available:', Object.keys(this.sectionNames || {}));

        return rules;
    }

    async writeRules(rules) {
        // Remove sectionNames from config and pass it separately
        const { sectionNames } = this;
        await FileHandler.writeRuleFiles(rules, this.config, sectionNames);
    }
}

module.exports = RuleGenerator; 