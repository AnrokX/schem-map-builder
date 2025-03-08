# HYTPIA World Editor

<p align="center">
<img width="500" alt="Screenshot 2025-03-04 at 1 51 53 PM" src="https://github.com/user-attachments/assets/b3ca4a7c-cdfc-41c6-a35c-445735dfe837" />
</p>

This repository contains the HYTOPIA World Editor, available for use at https://build.hytopia.com - it is intentionally open sourced to allow community members to actively contribute to its development. We encourage community members to take an active role if interested in forking this repository, and submitting new features & solutions via pull requests. All merged pull requests will deploy to https://build.hytopia.com for the greater community to use.

## Get Paid To Add Features And Fix Bugs! (OFFICIAL PAID BOUNTY SYSTEM)
Bounties are requests for bug fixes, refactors, or feature additions that meet certain criteria and are submitted as a pull request. The HYTOPIA team will review your PR relative to the bounty you're submitting it for, and if your PR is accepted, the designated bounty for the request will be awarded.

Additionally! If you have found a bug, issue with the world editor, or believe a specific feature would be valuable, you can [submit it via a Github issue here](https://github.com/hytopiagg/world-editor/issues). 

If your issue, request or bug is escalated by our team to become a bounty, you will be included in the official bounty issue, and receive 10% of the total bounty amount after you or another developer submits a pull request we deem acceptable to fulfill the bounty. That means, if a bounty is escalated and has a $500 reward, you as the submitter would receive $50, the developer whos PR is accepted for the bounty would receive $500. Bounty payments are distributed by the HYTOPIA team via PayPal.

[You can find a list of available bug, feature and refactor bounties that will be paid to the first participant to submit an accepted PR here](https://github.com/hytopiagg/world-editor/labels/BOUNTY)

## Available Scripts

In the project directory, you can run:

### `npm start`

Runs the app in the development mode.\
Open [http://localhost:3000](http://localhost:3000) to view it in your browser.

The page will reload when you make changes.\
You may also see any lint errors in the console.

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

Builds the app for production to the `build` folder.\
It correctly bundles React in production mode and optimizes the build for the best performance.

The build is minified and the filenames include the hashes.\
Your app is ready to be deployed!

See the section about [deployment](https://facebook.github.io/create-react-app/docs/deployment) for more information.

### `npm run eject`

**Note: this is a one-way operation. Once you `eject`, you can't go back!**

If you aren't satisfied with the build tool and configuration choices, you can `eject` at any time. This command will remove the single build dependency from your project.

Instead, it will copy all the configuration files and the transitive dependencies (webpack, Babel, ESLint, etc) right into your project so you have full control over them. All of the commands except `eject` will still work, but they will point to the copied scripts so you can tweak them. At this point you're on your own.

You don't have to ever use `eject`. The curated feature set is suitable for small and middle deployments, and you shouldn't feel obligated to use this feature. However we understand that this tool wouldn't be useful if you couldn't customize it when you are ready for it.

## Learn More

You can learn more in the [Create React App documentation](https://facebook.github.io/create-react-app/docs/getting-started).

To learn React, check out the [React documentation](https://reactjs.org/).

### Code Splitting

This section has moved here: [https://facebook.github.io/create-react-app/docs/code-splitting](https://facebook.github.io/create-react-app/docs/code-splitting)

### Analyzing the Bundle Size

This section has moved here: [https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size](https://facebook.github.io/create-react-app/docs/analyzing-the-bundle-size)

### Making a Progressive Web App

This section has moved here: [https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app](https://facebook.github.io/create-react-app/docs/making-a-progressive-web-app)

### Advanced Configuration

This section has moved here: [https://facebook.github.io/create-react-app/docs/advanced-configuration](https://facebook.github.io/create-react-app/docs/advanced-configuration)

### Deployment

This section has moved here: [https://facebook.github.io/create-react-app/docs/deployment](https://facebook.github.io/create-react-app/docs/deployment)

### `npm run build` fails to minify

This section has moved here: [https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify](https://facebook.github.io/create-react-app/docs/troubleshooting#npm-run-build-fails-to-minify)

# Enhanced Minecraft World Parser

A powerful parser for Minecraft world files (.mcworld, .zip) that extracts detailed information about block types, positions, and world structure.

## Features

- **Deep Block Data Extraction**: Extract detailed information about block types, their positions, and properties
- **Spatial Organization**: Blocks are organized by type, region (16x16x16), and chunk for efficient analysis
- **Height Mapping**: Generate height maps of the world's terrain
- **Block Distribution Analysis**: Analyze how blocks are distributed throughout the world
- **Data Export**: Export the parsed data as JSON for use in visualization or further analysis
- **ASCII Visualization**: Simple text-based visualization of height maps and block distribution

## Installation

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```

## Required Dependencies

```
npm install jszip prismarine-nbt pako
```

## Usage

### Parsing a Minecraft World

```
node test-minecraft-parser-runner.js <path-to-minecraft-world-file>
```

Example:
```
node test-minecraft-parser-runner.js ./worlds/my_world.mcworld
```

This will:
1. Parse the Minecraft world file
2. Extract detailed block data
3. Generate statistics about block types and distribution
4. Save the visualization data to `./output/visualization_data.json`

### Visualizing the Data

After parsing a world, you can visualize the data using:

```
node visualize-blocks.js
```

This will:
1. Load the visualization data from `./output/visualization_data.json`
2. Display statistics about the world
3. Show a histogram of block height distribution
4. Generate an ASCII visualization of the height map

## Output Data Format

The `visualization_data.json` file contains:

- **metadata**: Overall statistics about the world
- **blockTypeStats**: Statistics about each block type
- **topBlocks**: Detailed information about the most common blocks, including positions
- **heightMap**: Height map data organized by chunk

## Using the Block Data Collector in Your Own Project

You can import and use the BlockDataCollector in your own projects:

```javascript
const { BlockDataCollector } = require('./test-minecraft-parser');

// Track a block
BlockDataCollector.addBlock('minecraft:stone', x, y, z, { variant: 'granite' });

// Generate a report
const report = BlockDataCollector.generateVisualizationReport();
console.log(report);

// Export data
BlockDataCollector.exportData('./my-output.json');
```

## Future Enhancements

- 3D visualization using WebGL or Three.js
- More detailed block property extraction
- Structure detection (buildings, trees, caves)
- Biome analysis and correlation with block types

# Minecraft to Hytopia World Converter

This tool converts Minecraft world data in the visualization_data.json format to the Hytopia world format.

## How it Works

The conversion script (`src/convert.js`) takes a Minecraft world visualization file and converts it to the Hytopia world format using a mapping file that maps Minecraft block types to Hytopia block types.

### Input Files

- `output/visualization_data.json`: The Minecraft world data in the visualization format
- `public/mapping.json`: The mapping between Minecraft block types and Hytopia block types

### Output File

- `output/converted_world.json`: The converted world data in the Hytopia format

## How to Use

1. Make sure you have Node.js installed
2. Place your Minecraft world data in `output/visualization_data.json`
3. Make sure the mapping file is in `public/mapping.json`
4. Run the conversion script:

```bash
cd src
node convert.js
```

5. The converted world data will be saved to `output/converted_world.json`

## Configuration Options

The conversion script has several configuration options that can be modified in the script:

```javascript
const CONFIG = {
  generateDefaultMappings: false, // Set to false to use existing block IDs for unmapped blocks
  nextAvailableId: 100, // Starting ID for generated mappings (not used when generateDefaultMappings is false)
  updateMappingFile: false, // Set to false since we're not generating new mappings
  processAllBlocks: true, // Set to true to process all blocks, not just topBlocks
  defaultBlockType: "minecraft:stone", // Default block type to use for unmapped blocks
  fallbackBlockTypes: {
    // Map categories of blocks to appropriate fallbacks
    "grass": "minecraft:grass_block",
    "dirt": "minecraft:dirt",
    "wood": "minecraft:oak_log",
    "leaves": "minecraft:oak_leaves",
    "flower": "minecraft:dandelion",
    "stone": "minecraft:stone",
    "brick": "minecraft:stone_bricks",
    // ... more fallback mappings ...
  }
};
```

- `generateDefaultMappings`: When set to false, the script will use existing block IDs from the mapping file for unmapped blocks.
- `processAllBlocks`: When set to true, the script will process all blocks from all sections of the visualization data, not just the topBlocks section.
- `defaultBlockType`: The default block type to use for unmapped blocks if no specific fallback is found.
- `fallbackBlockTypes`: A mapping of block categories to appropriate fallback blocks. The script will check if an unmapped block name contains any of these categories and use the corresponding fallback block.

## Handling Unmapped Blocks

The script uses a smart fallback system for blocks that don't have direct mappings in the mapping.json file:

1. For each unmapped block, the script checks if its name contains any of the categories defined in `fallbackBlockTypes`.
2. If a match is found, the script uses the corresponding fallback block (e.g., "minecraft:spruce_planks" will use "minecraft:oak_planks").
3. If no match is found, the script uses the default block type defined in `defaultBlockType`.

This ensures that all blocks from the visualization data are included in the output, even if they don't have direct mappings.

## Mapping File Format

The mapping file (`public/mapping.json`) maps Minecraft block types to Hytopia block types. It has the following format:

```json
{
  "blocks": {
    "minecraft:stone": {
      "id": 37,
      "hytopiaBlock": "stone",
      "textureUri": "blocks/stone.png"
    },
    "minecraft:grass_block": {
      "id": 16,
      "hytopiaBlock": "grass",
      "textureUri": "blocks/grass.png"
    },
    ...
  }
}
```

## Adding New Block Mappings

To add a new block mapping, add a new entry to the `blocks` object in the mapping file:

```json
"minecraft:new_block": {
  "id": 123,
  "hytopiaBlock": "hytopia_block_name",
  "textureUri": "blocks/hytopia_block_texture.png"
}
```

Make sure the `id` is unique and matches the ID in the Hytopia world format.

## Troubleshooting

If a Minecraft block type doesn't have a mapping in the mapping file, it will be skipped during conversion. To fix this, add a mapping for the block type in the mapping file.

The script will print warnings for block types that don't have mappings.
