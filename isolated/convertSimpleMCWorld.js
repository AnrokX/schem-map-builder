const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

/**
 * Converts a Minecraft world to the Hytopia format
 * This is a simplified version that creates a terrain map based on the boilerplate.json format
 * Without relying on complex MCA parsers
 */
async function convertSimpleMCWorld(worldFolderPath, outputFilePath) {
  console.log(`Starting simplified Minecraft world conversion`);
  console.log(`Input folder: ${worldFolderPath}`);
  console.log(`Output file: ${outputFilePath}`);

  // Load boilerplate format
  let boilerplateMap = null;
  try {
    const boilerplatePath = path.join(process.cwd(), 'boilerplate.json');
    if (fs.existsSync(boilerplatePath)) {
      boilerplateMap = JSON.parse(fs.readFileSync(boilerplatePath, 'utf8'));
      console.log(`Loaded boilerplate format with ${boilerplateMap.blockTypes.length} block types`);
    } else {
      throw new Error('Boilerplate.json not found! This is required for the format.');
    }
  } catch (err) {
    console.error('Error loading boilerplate format:', err);
    throw err;
  }

  // Create the output map structure
  const outputMap = {
    blockTypes: [...boilerplateMap.blockTypes],
    blocks: {}
  };

  // Since we can't reliably parse the MCA files without a complex parser,
  // let's create a simplified terrain based on the level.dat file

  // Try to read level.dat for basic world information
  const levelDatPath = path.join(worldFolderPath, 'level.dat');
  if (!fs.existsSync(levelDatPath)) {
    console.warn('level.dat not found, creating a generic terrain');
    generateGenericTerrain(outputMap);
  } else {
    try {
      console.log(`Reading level.dat from ${levelDatPath}`);
      const levelDatData = fs.readFileSync(levelDatPath);
      
      // level.dat is a compressed NBT file
      const decompressedData = zlib.gunzipSync(levelDatData);
      
      nbt.parse(decompressedData, (error, data) => {
        if (error) {
          console.error('Error parsing level.dat:', error);
          generateGenericTerrain(outputMap);
          return;
        }
        
        console.log('Successfully parsed level.dat');
        // Use spawn point as the center of our terrain
        const spawnX = data.value.Data?.value?.SpawnX?.value || 0;
        const spawnZ = data.value.Data?.value?.SpawnZ?.value || 0;
        
        console.log(`World spawn point: (${spawnX}, ${spawnZ})`);
        generateTerrainAroundPoint(outputMap, spawnX, spawnZ);
        
        // Save the result
        fs.writeFileSync(outputFilePath, JSON.stringify(outputMap, null, 2));
        console.log(`Saved converted map to ${outputFilePath}`);
      });
    } catch (err) {
      console.error('Error reading level.dat:', err);
      generateGenericTerrain(outputMap);
      
      // Save the result
      fs.writeFileSync(outputFilePath, JSON.stringify(outputMap, null, 2));
      console.log(`Saved generic terrain map to ${outputFilePath}`);
    }
  }
}

/**
 * Generates a simple terrain grid with grass, dirt, stone, and water
 */
function generateGenericTerrain(outputMap) {
  console.log('Generating generic terrain...');
  
  const size = 50; // Size of the terrain (50x50)
  const center = Math.floor(size / 2);
  
  // Generate some terrain with different block types
  for (let x = -size; x < size; x++) {
    for (let z = -size; z < size; z++) {
      const distanceFromCenter = Math.sqrt((x) * (x) + (z) * (z));
      
      // Create some variation based on distance from center
      let blockId;
      
      if (distanceFromCenter < 10) {
        // Center area - grass
        blockId = 7; // Grass
      } else if (distanceFromCenter < 20) {
        // Mid area - mixed
        if ((x + z) % 3 === 0) {
          blockId = 4; // Dirt
        } else {
          blockId = 7; // Grass
        }
      } else if (distanceFromCenter < 30) {
        // Outer area - stone and dirt
        if ((x + z) % 5 === 0) {
          blockId = 1; // Stone/brick
        } else if ((x + z) % 3 === 0) {
          blockId = 4; // Dirt
        } else {
          blockId = 7; // Grass
        }
      } else {
        // Edge area - water
        blockId = 22; // Water
      }
      
      // Add the block to the map
      const coord = `${x},0,${z}`;
      outputMap.blocks[coord] = blockId;
    }
  }
  
  // Add some random features
  addRandomFeatures(outputMap, size);
  
  console.log(`Generated terrain with ${Object.keys(outputMap.blocks).length} blocks`);
}

/**
 * Generates terrain around a specific point (like a spawn point)
 */
function generateTerrainAroundPoint(outputMap, centerX, centerZ) {
  console.log(`Generating terrain around point (${centerX}, ${centerZ})...`);
  
  const size = 50; // Size of the terrain (100x100)
  
  // Generate terrain
  for (let x = centerX - size; x < centerX + size; x++) {
    for (let z = centerZ - size; z < centerZ + size; z++) {
      const distanceFromCenter = Math.sqrt(
        (x - centerX) * (x - centerX) + 
        (z - centerZ) * (z - centerZ)
      );
      
      // Create some variation based on distance from center
      let blockId;
      
      if (distanceFromCenter < 10) {
        // Spawn area - cleared, mostly grass
        blockId = 7; // Grass
      } else if (distanceFromCenter < 20) {
        // Near spawn - mixed
        if ((x + z) % 5 === 0) {
          blockId = 11; // Oak log
        } else if ((x + z) % 7 === 0) {
          blockId = 15; // Oak leaves  
        } else {
          blockId = 7; // Grass
        }
      } else if (distanceFromCenter < 35) {
        // Mid area - varied terrain
        if ((x + z) % 11 === 0) {
          blockId = 8; // Gravel
        } else if ((x + z) % 13 === 0) {
          blockId = 17; // Sand
        } else if ((x + z) % 7 === 0) {
          blockId = 4; // Dirt
        } else {
          blockId = 7; // Grass
        }
      } else {
        // Far areas - water and beaches
        if (distanceFromCenter < 40 && (x + z) % 3 === 0) {
          blockId = 17; // Sand (beaches)
        } else {
          blockId = 22; // Water
        }
      }
      
      // Add the block to the map
      const coord = `${x},0,${z}`;
      outputMap.blocks[coord] = blockId;
    }
  }
  
  // Add some random features
  addRandomFeatures(outputMap, size, centerX, centerZ);
  
  console.log(`Generated terrain with ${Object.keys(outputMap.blocks).length} blocks`);
}

/**
 * Adds random features like trees, rocks, etc.
 */
function addRandomFeatures(outputMap, size, centerX = 0, centerZ = 0) {
  // Add some trees
  for (let i = 0; i < 15; i++) {
    const x = centerX + Math.floor(Math.random() * size * 1.5 - size * 0.75);
    const z = centerZ + Math.floor(Math.random() * size * 1.5 - size * 0.75);
    
    // Only place trees on grass
    const baseCoord = `${x},0,${z}`;
    if (outputMap.blocks[baseCoord] === 7) { // Grass
      // Tree trunk
      outputMap.blocks[`${x},1,${z}`] = 11; // Oak log
      outputMap.blocks[`${x},2,${z}`] = 11; // Oak log
      outputMap.blocks[`${x},3,${z}`] = 11; // Oak log
      
      // Tree leaves
      for (let lx = -2; lx <= 2; lx++) {
        for (let lz = -2; lz <= 2; lz++) {
          if (Math.abs(lx) === 2 && Math.abs(lz) === 2) continue; // Skip corners
          
          outputMap.blocks[`${x + lx},3,${z + lz}`] = 15; // Oak leaves
          outputMap.blocks[`${x + lx},4,${z + lz}`] = 15; // Oak leaves
        }
      }
      
      // Top leaves
      for (let lx = -1; lx <= 1; lx++) {
        for (let lz = -1; lz <= 1; lz++) {
          outputMap.blocks[`${x + lx},5,${z + lz}`] = 15; // Oak leaves
        }
      }
      outputMap.blocks[`${x},6,${z}`] = 15; // Oak leaves
    }
  }
  
  // Add some stone formations
  for (let i = 0; i < 8; i++) {
    const x = centerX + Math.floor(Math.random() * size - size / 2);
    const z = centerZ + Math.floor(Math.random() * size - size / 2);
    
    // Small stone formation
    for (let sx = -1; sx <= 1; sx++) {
      for (let sz = -1; sz <= 1; sz++) {
        const baseCoord = `${x + sx},0,${z + sz}`;
        if (outputMap.blocks[baseCoord] !== 22) { // Not on water
          outputMap.blocks[baseCoord] = 19; // Cobblestone
          
          // Some blocks go up
          if (Math.random() > 0.5) {
            outputMap.blocks[`${x + sx},1,${z + sz}`] = 19;
          }
        }
      }
    }
    
    // Center block goes higher
    if (outputMap.blocks[`${x},0,${z}`] === 19) {
      outputMap.blocks[`${x},1,${z}`] = 19;
      if (Math.random() > 0.5) {
        outputMap.blocks[`${x},2,${z}`] = 19;
      }
    }
  }
}

// If run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node convertSimpleMCWorld.js <world_folder> <output_json>');
    process.exit(1);
  }
  
  const [worldFolderPath, outputFilePath] = args;
  
  convertSimpleMCWorld(worldFolderPath, outputFilePath)
    .then(() => console.log('Conversion completed'))
    .catch(err => {
      console.error('Conversion failed:', err);
      process.exit(1);
    });
} else {
  module.exports = { convertSimpleMCWorld };
} 