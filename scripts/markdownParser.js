const ConfigParser = require('./configParser');

class MarkdownParser {
    static extractSections(content) {
        const sections = {};
        let currentPath = [];  // Stack to track current section path
        let currentConfig = {};
        let suppressConfigUntilLevel = null;  // Track when to suppress ai-rules processing

        content.split('\n').forEach(line => {
            // Check for ai-rules comment
            const configMatch = line.match(/<!--\s*ai-rules([^>]*?)-->/);
            if (configMatch) {
                // Skip processing ai-rules tags if we're in a unified subsection
                if (suppressConfigUntilLevel !== null) {
                    return;
                }
                
                const newConfig = ConfigParser.parseConfigAttributes(configMatch[1]);
                if (currentPath.length > 0) {
                    // Apply to current section if we're in one
                    let section = sections;
                    for (let i = 0; i < currentPath.length - 1; i++) {
                        section = section[currentPath[i]].sections;
                    }
                    section[currentPath[currentPath.length - 1]].config = {
                        ...section[currentPath[currentPath.length - 1]].config,
                        ...newConfig
                    };
                } else {
                    // Store for next section if we're not in one yet
                    currentConfig = newConfig;
                }
                return;
            }

            // Match any heading level
            const headingMatch = line.match(/^(#+)\s+(.+)/);
            if (headingMatch) {
                const level = headingMatch[1].length;  // Number of # symbols
                const title = headingMatch[2];

                // Check if we should stop suppressing config processing
                if (suppressConfigUntilLevel !== null && level <= suppressConfigUntilLevel) {
                    suppressConfigUntilLevel = null;
                }

                // Pop levels from path until we're at the right level
                while (currentPath.length >= level) {
                    currentPath.pop();
                }

                // Add new section at this level
                currentPath.push(title);

                // Navigate to the correct location and create the section
                let section = sections;
                for (let i = 0; i < currentPath.length - 1; i++) {
                    if (section[currentPath[i]].config.unifySubsections) {
                        // If parent has unifySubsections, add as content
                        section[currentPath[i]].content.push('');  // Add blank line
                        section[currentPath[i]].content.push(line);
                        currentPath.pop();  // Remove from path as it's not a real section
                        suppressConfigUntilLevel = level;  // Suppress ai-rules tags until we get back to this level or higher
                        return;
                    }
                    section = section[currentPath[i]].sections;
                }

                if (currentPath.length === 1) {
                    // Top level section
                    sections[title] = {
                        config: currentConfig,
                        content: [],
                        sections: {}
                    };
                } else {
                    // Subsection
                    section[title] = {
                        config: currentConfig,
                        content: [],
                        sections: {}
                    };
                }
                currentConfig = {};  // Reset for next use
            } else if (currentPath.length > 0 && line.trim()) {
                // Add content to the current section
                let section = sections;
                let targetSection = currentPath[currentPath.length - 1];

                // Check if any parent has unifySubsections
                for (let i = 0; i < currentPath.length - 1; i++) {
                    if (section[currentPath[i]].config.unifySubsections) {
                        // Add to the parent section instead
                        section[currentPath[i]].content.push(line);
                        return;
                    }
                    section = section[currentPath[i]].sections;
                }

                // If no unification, add to the current section
                section[targetSection].content.push(line);
            }
        });

        return sections;
    }

    static extractLinks(content) {
        const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
        return Array.from(content.matchAll(linkPattern))
            .map(match => ({
                title: match[1],
                path: match[2].replace('./', '')
            }));
    }
}

module.exports = MarkdownParser; 