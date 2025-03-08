/**
 * Test Runner for Minecraft World Parser
 * 
 * This script runs the enhanced Minecraft world parser on a specified world file
 * and displays the results, focusing on detailed block data extraction.
 * 
 * Usage: node test-minecraft-parser-runner.js <path-to-minecraft-world-file>
 */

const path = require('path');
const { testMinecraftWorldParsing } = require('./test-minecraft-parser');

// Check if a world file path was provided
const worldFilePath = process.argv[2];
if (!worldFilePath) {
    console.error('Error: No Minecraft world file specified');
    console.log('\nUsage: node test-minecraft-parser-runner.js <path-to-minecraft-world-file>');
    console.log('\nExample: node test-minecraft-parser-runner.js ./worlds/my_world.mcworld');
    process.exit(1);
}

// Ensure the path is absolute
const absolutePath = path.resolve(worldFilePath);
console.log(`Processing Minecraft world file: ${absolutePath}`);

// Run the enhanced parser
console.log('Starting world analysis with enhanced block data extraction...\n');
testMinecraftWorldParsing(absolutePath)
    .then(() => {
        console.log('\nWorld analysis complete.');
        console.log('Check the ./output directory for visualization_data.json with detailed block information.');
    })
    .catch(error => {
        console.error('Error during world analysis:', error);
        process.exit(1);
    }); 