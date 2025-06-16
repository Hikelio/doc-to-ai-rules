class ConfigParser {
    static parseConfigAttributes(configStr) {
        const config = {
            type: null,
            path: null,
            globs: null,
            description: null,
            projectTypes: null,  // Will inherit from parent if null
            unifySubsections: false
        };

        // Extract type
        const typeMatch = configStr.match(/type="([^"]+)"/);
        if (typeMatch) config.type = typeMatch[1];

        // Extract path
        const pathMatch = configStr.match(/path="([^"]+)"/);
        if (pathMatch) config.path = pathMatch[1];

        // Extract globs
        const globsMatch = configStr.match(/globs="([^"]+)"/);
        if (globsMatch) config.globs = globsMatch[1];

        // Extract description
        const descriptionMatch = configStr.match(/description="([^"]+)"/);
        if (descriptionMatch) config.description = descriptionMatch[1];

        // Extract projectTypes as JSON array
        const projectTypesMatch = configStr.match(/projectTypes='(\[[^\]]+\])'/);
        if (projectTypesMatch) {
            try {
                config.projectTypes = JSON.parse(projectTypesMatch[1]);
            } catch (e) {
                console.warn('[WARNING] ⚠️ Invalid projectTypes JSON in ai-rules:', projectTypesMatch[1]);
            }
        }

        // Extract unifySubsections
        const unifyMatch = configStr.match(/unifySubsections="([^"]+)"/);
        if (unifyMatch) config.unifySubsections = unifyMatch[1].toLowerCase() === 'true';

        return config;
    }

    static formatTitle(title) {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    static calculateEffectiveConfig(section, parentConfig = null, defaultConfig = {}) {
        const sectionConfig = section.config || {};
        
        // Handle globs and description inheritance - they are mutually exclusive
        let effectiveGlobs = sectionConfig.globs || null;
        let effectiveDescription = sectionConfig.description || null;
        
        // Only inherit globs from parent if current section has no globs and no description
        if (!effectiveGlobs && !effectiveDescription) {
            effectiveGlobs = parentConfig?.globs || null;
        }
        
        // Never inherit description from parent - descriptions are section-specific
        
        const effectiveConfig = {
            type: sectionConfig.type || parentConfig?.type || defaultConfig.defaultRuleType,
            path: sectionConfig.path || parentConfig?.path || defaultConfig.defaultRulePath,
            globs: effectiveGlobs,
            description: effectiveDescription,
            projectTypes: sectionConfig.projectTypes || parentConfig?.projectTypes || defaultConfig.defaultProjectTypes,
            unifySubsections: sectionConfig.unifySubsections ?? parentConfig?.unifySubsections ?? false
        };

        return effectiveConfig;
    }

    // Separate validation method that can be called from ruleGenerator with proper context
    static validateEffectiveConfiguration(effectiveConfig, sectionTitle) {
        const warnings = [];

        // Check for 'globs' with non-auto_attached types in effective config
        if (effectiveConfig.globs && effectiveConfig.type !== 'auto_attached') {
            warnings.push(`Section "${sectionTitle}" has globs="${effectiveConfig.globs}" but effective type="${effectiveConfig.type}" (globs only work with auto_attached)`);
        }

        // Check for 'description' with non-agent_requested types in effective config
        if (effectiveConfig.description && effectiveConfig.type !== 'agent_requested') {
            warnings.push(`Section "${sectionTitle}" has description="${effectiveConfig.description}" but effective type="${effectiveConfig.type}" (descriptions only work with agent_requested)`);
        }

        // Output warnings with context
        if (warnings.length > 0) {
            console.warn(`\n[WARNING] ⚠️ Effective configuration validation warnings:`);
            warnings.forEach(warning => {
                console.warn(`   ${warning}`);
            });
            console.warn('   This may be due to configuration inheritance from parent sections.');
            console.warn('');
        }
    }
}

module.exports = ConfigParser; 