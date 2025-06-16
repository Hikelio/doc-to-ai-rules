const RuleGenerator = require('./ruleGenerator');
const FileHandler = require('./fileHandler');
const yaml = require('js-yaml');
const fs = require('fs');

async function main() {
    const [configPath = '.github/ai-rules-config.yml'] = process.argv.slice(2);
    
    console.log('Starting rule generation...');
    console.log('- Config path:', configPath);
    
    // Check if config path exists
    if (!fs.existsSync(configPath)) {
        console.error(`[ERROR] ❗  Config file does not exist: ${configPath}`);
        process.exit(1);
    }
    
    // Load config from YAML file
    const config = yaml.load(fs.readFileSync(configPath, 'utf8'));
    console.log('Loaded config:', JSON.stringify(config, null, 2));

    // Get docsPath from config, default to '.' if not specified
    const docsPath = config.docsPath || '.';
    console.log('- Docs path:', docsPath);
    
    // Check if docs path exists
    if (!fs.existsSync(docsPath)) {
        console.error(`[ERROR] ❗  Documentation path does not exist: ${docsPath}`);
        process.exit(1);
    }

    const generator = new RuleGenerator(docsPath, config);
    const rules = await generator.generateRules();
    
    console.log(`Generated ${rules.length} rules`);
    await generator.writeRules(rules);
    
    console.log('Rules generated successfully!');
    console.log('- Index file: ai_rules.json');
    console.log('- Rules directory: .cursor/rules/');
}

main().catch(error => {
    console.error('Error generating rules:', error);
    process.exit(1);
}); 