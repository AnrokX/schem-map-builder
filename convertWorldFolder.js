const fs = require('fs');
const path = require('path');
const { Anvil } = require('prismarine-provider-anvil');
const Vec3 = require('vec3');

// Block ID mapping from Minecraft IDs to the Hytopia block IDs in boilerplate.json
const blockMapping = {
  'minecraft:stone': 1,
  'minecraft:dirt': 4,
  'minecraft:grass_block': 7,
  'minecraft:cobblestone': 19,
  'minecraft:oak_planks': 16,
  'minecraft:water': 22,
  'minecraft:lava': 21,
  'minecraft:sand': 17,
  'minecraft:gravel': 8,
  'minecraft:gold_ore': 29,
  'minecraft:iron_ore': 28,
  'minecraft:coal_ore': 30,
  'minecraft:oak_log': 11,
  'minecraft:oak_leaves': 15,
  'minecraft:glass': 6,
  'minecraft:brick': 1,
  'minecraft:stone_bricks': 20,
  // Add more mappings as needed
};

// Default to stone if block type is unknown
const DEFAULT_BLOCK_ID = 1;

async function convertWorldFolder(worldFolderPath, outputFilePath, options = {}) {
  console.log(`Starting Minecraft world conversion from: ${worldFolderPath}`);
  console.log(`Output will be saved to: ${outputFilePath}`);
  
  const regionFolderPath = path.join(worldFolderPath, 'region');
  
  if (!fs.existsSync(regionFolderPath)) {
    throw new Error(`Region folder not found at ${regionFolderPath}`);
  }

  // Get list of region files
  const regionFiles = fs.readdirSync(regionFolderPath)
    .filter(file => file.endsWith('.mca'))
    .map(file => path.join(regionFolderPath, file));
    
  console.log(`Found ${regionFiles.length} region files`);
  
  // Prepare output structure
  const hytopiaMap = {
    blockTypes: [], // We'll populate this from boilerplate.json
    blocks: {}
  };
  
  // Load block types from boilerplate
  const boilerplatePath = path.join(process.cwd(), 'boilerplate.json');
  if (fs.existsSync(boilerplatePath)) {
    try {
      const boilerplate = JSON.parse(fs.readFileSync(boilerplatePath, 'utf8'));
      hytopiaMap.blockTypes = boilerplate.blockTypes;
      console.log(`Loaded ${hytopiaMap.blockTypes.length} block types from boilerplate.json`);
    } catch (err) {
      console.error('Error loading block types from boilerplate:', err);
      throw err;
    }
  } else {
    console.warn('boilerplate.json not found, using default block types');
    // Provide some default block types
    hytopiaMap.blockTypes = [
      { id: 1, name: "stone", textureUri: "blocks/stone.png" },
      { id: 4, name: "dirt", textureUri: "blocks/dirt.png" },
      { id: 7, name: "grass", textureUri: "blocks/grass" }
    ];
  }

  // Set conversion bounds (which region of the world to convert)
  const bounds = options.bounds || {
    minX: -128, maxX: 128,
    minY: 0, maxY: 128,  // Minecraft height range
    minZ: -128, maxZ: 128
  };
  
  // Process each region file
  let totalBlocks = 0;
  for (const regionFile of regionFiles) {
    console.log(`Processing region file: ${path.basename(regionFile)}`);
    
    // Extract region coordinates from filename
    const regionCoords = path.basename(regionFile, '.mca').split('.');
    const regionX = parseInt(regionCoords[1]);
    const regionZ = parseInt(regionCoords[2]);
    
    // Skip regions outside bounds
    if (regionX * 512 > bounds.maxX || (regionX + 1) * 512 < bounds.minX ||
        regionZ * 512 > bounds.maxZ || (regionZ + 1) * 512 < bounds.minZ) {
      console.log(`Skipping region (${regionX}, ${regionZ}) - outside bounds`);
      continue;
    }
    
    // Load the region
    const anvil = new Anvil(worldFolderPath);
    
    // Process each chunk in the region (16x16 chunks per region)
    for (let cx = 0; cx < 32; cx++) {
      for (let cz = 0; cz < 32; cz++) {
        const chunkX = regionX * 32 + cx;
        const chunkZ = regionZ * 32 + cz;
        
        // Skip chunks outside bounds
        if (chunkX * 16 > bounds.maxX || (chunkX + 1) * 16 < bounds.minX ||
            chunkZ * 16 > bounds.maxZ || (chunkZ + 1) * 16 < bounds.minZ) {
          continue;
        }
        
        try {
          // Load chunk data
          const chunk = await anvil.load(chunkX, chunkZ);
          
          if (!chunk) {
            continue; // Skip ungenerated chunks
          }
          
          // Process each block in the chunk
          for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
              // Calculate absolute coordinates
              const worldX = chunkX * 16 + x;
              const worldZ = chunkZ * 16 + z;
              
              // Skip if outside bounds
              if (worldX < bounds.minX || worldX > bounds.maxX ||
                  worldZ < bounds.minZ || worldZ > bounds.maxZ) {
                continue;
              }
              
              // Find highest non-air block for this column
              let highestY = -1;
              for (let y = bounds.maxY; y >= bounds.minY; y--) {
                try {
                  const pos = new Vec3(x, y, z);
                  const block = chunk.getBlock(pos);
                  
                  if (block && block.name !== 'minecraft:air') {
                    highestY = y;
                    break;
                  }
                } catch (error) {
                  // Skip invalid blocks
                  continue;
                }
              }
              
              if (highestY >= bounds.minY) {
                // Get the block at the highest position
                const pos = new Vec3(x, highestY, z);
                const block = chunk.getBlock(pos);
                
                if (block && block.name) {
                  // Map Minecraft block type to Hytopia ID
                  const blockId = blockMapping[block.name] || DEFAULT_BLOCK_ID;
                  
                  // Add to output
                  const coord = `${worldX},0,${worldZ}`;
                  hytopiaMap.blocks[coord] = blockId;
                  totalBlocks++;
                }
              }
            }
          }
        } catch (error) {
          console.error(`Error processing chunk (${chunkX}, ${chunkZ}):`, error);
          // Continue with next chunk
        }
      }
    }
  }
  
  console.log(`Conversion complete. Added ${totalBlocks} blocks to the map.`);
  
  // Save output file
  fs.writeFileSync(outputFilePath, JSON.stringify(hytopiaMap, null, 2));
  console.log(`Saved output to ${outputFilePath}`);
}

// If run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node convertWorldFolder.js <world_folder_path> <output_json_path>');
    process.exit(1);
  }
  
  const [worldFolderPath, outputFilePath] = args;
  
  console.log('Starting conversion with:');
  console.log('- World folder:', worldFolderPath);
  console.log('- Output file:', outputFilePath);
  console.log('- Using prismarine-provider-anvil version:', require('prismarine-provider-anvil/package.json').version);
  
  convertWorldFolder(worldFolderPath, outputFilePath)
    .then(() => console.log('Conversion completed successfully'))
    .catch(err => {
      console.error('Conversion failed with error:');
      console.error(err.message);
      console.error(err.stack);
      process.exit(1);
    });
} else {
  // Export for use as a module
  module.exports = { convertWorldFolder };
} 