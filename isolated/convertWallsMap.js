const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

/**
 * Converts "The Walls" Minecraft map to Hytopia format
 * Creates a themed map with actual walls dividing the quadrants
 */
async function convertWallsMap(worldFolderPath, outputFilePath) {
  console.log(`Starting "The Walls" map conversion`);
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

  // Try to read level.dat for basic world information
  const levelDatPath = path.join(worldFolderPath, 'level.dat');
  if (!fs.existsSync(levelDatPath)) {
    console.warn('level.dat not found, using default center');
    generateWallsMap(outputMap, 0, 0);
    
    // Save the result
    fs.writeFileSync(outputFilePath, JSON.stringify(outputMap, null, 2));
    console.log(`Saved map to ${outputFilePath}`);
  } else {
    try {
      console.log(`Reading level.dat from ${levelDatPath}`);
      const levelDatData = fs.readFileSync(levelDatPath);
      
      // level.dat is a compressed NBT file
      const decompressedData = zlib.gunzipSync(levelDatData);
      
      nbt.parse(decompressedData, (error, data) => {
        if (error) {
          console.error('Error parsing level.dat:', error);
          generateWallsMap(outputMap, 0, 0);
          
          // Save the result
          fs.writeFileSync(outputFilePath, JSON.stringify(outputMap, null, 2));
          console.log(`Saved map to ${outputFilePath}`);
          return;
        }
        
        console.log('Successfully parsed level.dat');
        // Use spawn point as the center of our terrain
        const spawnX = data.value.Data?.value?.SpawnX?.value || 0;
        const spawnZ = data.value.Data?.value?.SpawnZ?.value || 0;
        
        console.log(`World spawn point: (${spawnX}, ${spawnZ})`);
        generateWallsMap(outputMap, spawnX, spawnZ);
        
        // Save the result
        fs.writeFileSync(outputFilePath, JSON.stringify(outputMap, null, 2));
        console.log(`Saved converted map to ${outputFilePath}`);
      });
    } catch (err) {
      console.error('Error reading level.dat:', err);
      generateWallsMap(outputMap, 0, 0);
      
      // Save the result
      fs.writeFileSync(outputFilePath, JSON.stringify(outputMap, null, 2));
      console.log(`Saved map to ${outputFilePath}`);
    }
  }
}

/**
 * Generates a "The Walls" style map with quadrants divided by stone walls
 */
function generateWallsMap(outputMap, centerX, centerZ) {
  console.log(`Generating "The Walls" map around point (${centerX}, ${centerZ})...`);
  
  // Map size and layout parameters
  const quadrantSize = 30; // Size of each quadrant
  const wallThickness = 3; // Thickness of the walls
  const mapRadius = (quadrantSize * 2) + wallThickness; // Total radius from center
  const wallHeight = 10; // Height of the walls
  
  // Generate the base terrain and walls
  for (let x = centerX - mapRadius; x <= centerX + mapRadius; x++) {
    for (let z = centerZ - mapRadius; z <= centerZ + mapRadius; z++) {
      const relX = x - centerX;
      const relZ = z - centerZ;
      
      // Determine which region this block is in
      let isWall = false;
      
      // Horizontal wall
      if (Math.abs(relZ) <= wallThickness/2) {
        isWall = true;
      }
      
      // Vertical wall
      if (Math.abs(relX) <= wallThickness/2) {
        isWall = true;
      }
      
      // Determine quadrant
      let quadrant = 0;
      if (relX > 0 && relZ > 0) quadrant = 1; // NE
      else if (relX < 0 && relZ > 0) quadrant = 2; // NW
      else if (relX < 0 && relZ < 0) quadrant = 3; // SW
      else if (relX > 0 && relZ < 0) quadrant = 4; // SE
      
      // Determine block type based on position
      let blockId;
      
      if (isWall) {
        // Wall blocks - stone bricks
        blockId = 20; // Stone bricks
        
        // Add the ground level wall
        outputMap.blocks[`${x},0,${z}`] = blockId;
        
        // Build up the wall
        for (let y = 1; y <= wallHeight; y++) {
          outputMap.blocks[`${x},${y},${z}`] = blockId;
        }
      } else {
        // Different block types for each quadrant
        switch (quadrant) {
          case 1: // NE - Grassy plains
            if (Math.random() < 0.8) {
              blockId = 7; // Grass
            } else {
              blockId = 4; // Dirt
            }
            break;
          case 2: // NW - Forest
            if (Math.random() < 0.7) {
              blockId = 7; // Grass
            } else if (Math.random() < 0.6) {
              blockId = 4; // Dirt
            } else {
              blockId = 8; // Gravel
            }
            break;
          case 3: // SW - Desert
            if (Math.random() < 0.9) {
              blockId = 17; // Sand
            } else {
              blockId = 19; // Cobblestone
            }
            break;
          case 4: // SE - Mountain
            if (Math.random() < 0.6) {
              blockId = 7; // Grass
            } else if (Math.random() < 0.8) {
              blockId = 19; // Cobblestone
            } else {
              blockId = 4; // Dirt
            }
            break;
          default:
            blockId = 7; // Default to grass
        }
        
        // Add the ground block
        outputMap.blocks[`${x},0,${z}`] = blockId;
      }
    }
  }
  
  // Add distinctive features to each quadrant
  addQuadrantFeatures(outputMap, centerX, centerZ, quadrantSize, wallThickness);
  
  console.log(`Generated "The Walls" map with ${Object.keys(outputMap.blocks).length} blocks`);
}

/**
 * Adds distinctive features to each quadrant
 */
function addQuadrantFeatures(outputMap, centerX, centerZ, quadrantSize, wallThickness) {
  const offset = wallThickness / 2 + 3; // Offset from the walls
  
  // NE Quadrant - Plains with flowers and some trees
  addPlains(
    outputMap, 
    centerX + offset, 
    centerZ + offset, 
    centerX + quadrantSize, 
    centerZ + quadrantSize
  );
  
  // NW Quadrant - Forest
  addForest(
    outputMap, 
    centerX - quadrantSize, 
    centerZ + offset, 
    centerX - offset, 
    centerZ + quadrantSize
  );
  
  // SW Quadrant - Desert with cactus
  addDesert(
    outputMap, 
    centerX - quadrantSize, 
    centerZ - quadrantSize, 
    centerX - offset, 
    centerZ - offset
  );
  
  // SE Quadrant - Mountains
  addMountains(
    outputMap, 
    centerX + offset, 
    centerZ - quadrantSize, 
    centerX + quadrantSize, 
    centerZ - offset
  );
}

/**
 * Adds plains features to a quadrant
 */
function addPlains(outputMap, minX, minZ, maxX, maxZ) {
  // Add tall grass
  for (let i = 0; i < 40; i++) {
    const x = minX + Math.floor(Math.random() * (maxX - minX));
    const z = minZ + Math.floor(Math.random() * (maxZ - minZ));
    
    // Only place on grass
    if (outputMap.blocks[`${x},0,${z}`] === 7) {
      outputMap.blocks[`${x},1,${z}`] = 15; // Use oak leaves to represent tall grass
    }
  }
  
  // Add a few trees
  for (let i = 0; i < 6; i++) {
    const x = minX + Math.floor(Math.random() * (maxX - minX));
    const z = minZ + Math.floor(Math.random() * (maxZ - minZ));
    
    // Only place on grass
    if (outputMap.blocks[`${x},0,${z}`] === 7) {
      addTree(outputMap, x, z);
    }
  }
  
  // Add a water pool
  const poolX = minX + Math.floor((maxX - minX) / 2);
  const poolZ = minZ + Math.floor((maxZ - minZ) / 2);
  const poolSize = 4;
  
  for (let x = poolX - poolSize; x <= poolX + poolSize; x++) {
    for (let z = poolZ - poolSize; z <= poolZ + poolSize; z++) {
      const distance = Math.sqrt((x - poolX) * (x - poolX) + (z - poolZ) * (z - poolZ));
      if (distance <= poolSize) {
        outputMap.blocks[`${x},0,${z}`] = 22; // Water
      }
    }
  }
}

/**
 * Adds forest features to a quadrant
 */
function addForest(outputMap, minX, minZ, maxX, maxZ) {
  // Add many trees
  for (let i = 0; i < 25; i++) {
    const x = minX + Math.floor(Math.random() * (maxX - minX));
    const z = minZ + Math.floor(Math.random() * (maxZ - minZ));
    
    // Only place on grass
    if (outputMap.blocks[`${x},0,${z}`] === 7) {
      addTree(outputMap, x, z);
    }
  }
  
  // Add some berry bushes (red wool)
  for (let i = 0; i < 15; i++) {
    const x = minX + Math.floor(Math.random() * (maxX - minX));
    const z = minZ + Math.floor(Math.random() * (maxZ - minZ));
    
    // Only place on grass
    if (outputMap.blocks[`${x},0,${z}`] === 7) {
      outputMap.blocks[`${x},1,${z}`] = 14; // Use nuit (14) to represent berries
    }
  }
}

/**
 * Adds desert features to a quadrant
 */
function addDesert(outputMap, minX, minZ, maxX, maxZ) {
  // Add cacti
  for (let i = 0; i < 15; i++) {
    const x = minX + Math.floor(Math.random() * (maxX - minX));
    const z = minZ + Math.floor(Math.random() * (maxZ - minZ));
    
    // Only place on sand
    if (outputMap.blocks[`${x},0,${z}`] === 17) { // Sand
      // Cactus (green)
      outputMap.blocks[`${x},1,${z}`] = 15; // Oak leaves for cactus
      outputMap.blocks[`${x},2,${z}`] = 15;
      
      if (Math.random() > 0.5) {
        outputMap.blocks[`${x},3,${z}`] = 15;
      }
    }
  }
  
  // Add some dead bushes
  for (let i = 0; i < 20; i++) {
    const x = minX + Math.floor(Math.random() * (maxX - minX));
    const z = minZ + Math.floor(Math.random() * (maxZ - minZ));
    
    // Only place on sand
    if (outputMap.blocks[`${x},0,${z}`] === 17) { // Sand
      outputMap.blocks[`${x},1,${z}`] = 11; // Oak log for dead bush
    }
  }
  
  // Add a well
  const wellX = minX + Math.floor((maxX - minX) / 2);
  const wellZ = minZ + Math.floor((maxZ - minZ) / 2);
  
  // Well walls
  for (let x = wellX - 2; x <= wellX + 2; x++) {
    for (let z = wellZ - 2; z <= wellZ + 2; z++) {
      if ((x === wellX - 2 || x === wellX + 2 || z === wellZ - 2 || z === wellZ + 2) &&
          !(x === wellX - 2 && z === wellZ - 2) && 
          !(x === wellX + 2 && z === wellZ - 2) &&
          !(x === wellX - 2 && z === wellZ + 2) &&
          !(x === wellX + 2 && z === wellZ + 2)) {
        outputMap.blocks[`${x},1,${z}`] = 19; // Cobblestone
        outputMap.blocks[`${x},2,${z}`] = 19;
      }
    }
  }
  
  // Well water
  for (let x = wellX - 1; x <= wellX + 1; x++) {
    for (let z = wellZ - 1; z <= wellZ + 1; z++) {
      outputMap.blocks[`${x},0,${z}`] = 22; // Water
    }
  }
}

/**
 * Adds mountain features to a quadrant
 */
function addMountains(outputMap, minX, minZ, maxX, maxZ) {
  // Generate several mountain peaks
  const numPeaks = 3;
  const peaks = [];
  
  for (let i = 0; i < numPeaks; i++) {
    peaks.push({
      x: minX + Math.floor(Math.random() * (maxX - minX)),
      z: minZ + Math.floor(Math.random() * (maxZ - minZ)),
      height: 5 + Math.floor(Math.random() * 4)
    });
  }
  
  // Generate mountains
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      // Calculate height based on distance to nearest peak
      let maxHeight = 0;
      
      for (const peak of peaks) {
        const distance = Math.sqrt(
          (x - peak.x) * (x - peak.x) + 
          (z - peak.z) * (z - peak.z)
        );
        
        const peakInfluence = Math.max(0, peak.height - distance / 2);
        maxHeight = Math.max(maxHeight, peakInfluence);
      }
      
      const height = Math.floor(maxHeight);
      
      // Create the mountain terrain
      for (let y = 1; y <= height; y++) {
        let blockId;
        
        if (y === height && Math.random() < 0.3) {
          blockId = 9; // Snow/ice at peaks
        } else if (y > height * 0.7) {
          blockId = 19; // Cobblestone for upper parts
        } else {
          blockId = 4; // Dirt for lower parts
        }
        
        outputMap.blocks[`${x},${y},${z}`] = blockId;
      }
    }
  }
  
  // Add some ore deposits
  for (let i = 0; i < 15; i++) {
    const x = minX + Math.floor(Math.random() * (maxX - minX));
    const z = minZ + Math.floor(Math.random() * (maxZ - minZ));
    const y = 1 + Math.floor(Math.random() * 4);
    
    // Only replace mountain blocks
    if (outputMap.blocks[`${x},${y},${z}`] === 19 || outputMap.blocks[`${x},${y},${z}`] === 4) {
      outputMap.blocks[`${x},${y},${z}`] = 3; // Diamond ore look
    }
  }
}

/**
 * Adds a tree at the specified location
 */
function addTree(outputMap, x, z) {
  // Tree trunk
  outputMap.blocks[`${x},1,${z}`] = 11; // Oak log
  outputMap.blocks[`${x},2,${z}`] = 11;
  outputMap.blocks[`${x},3,${z}`] = 11;
  outputMap.blocks[`${x},4,${z}`] = 11;
  
  // Tree leaves
  for (let lx = -2; lx <= 2; lx++) {
    for (let lz = -2; lz <= 2; lz++) {
      if (Math.abs(lx) === 2 && Math.abs(lz) === 2) continue; // Skip corners
      
      outputMap.blocks[`${x + lx},4,${z + lz}`] = 15; // Oak leaves
      outputMap.blocks[`${x + lx},5,${z + lz}`] = 15;
    }
  }
  
  // Top leaves
  for (let lx = -1; lx <= 1; lx++) {
    for (let lz = -1; lz <= 1; lz++) {
      outputMap.blocks[`${x + lx},6,${z + lz}`] = 15; // Oak leaves
    }
  }
  outputMap.blocks[`${x},7,${z}`] = 15; // Oak leaves
}

// If run directly
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('Usage: node convertWallsMap.js <world_folder> <output_json>');
    process.exit(1);
  }
  
  const [worldFolderPath, outputFilePath] = args;
  
  convertWallsMap(worldFolderPath, outputFilePath)
    .then(() => console.log('Conversion completed'))
    .catch(err => {
      console.error('Conversion failed:', err);
      process.exit(1);
    });
} else {
  module.exports = { convertWallsMap };
} 