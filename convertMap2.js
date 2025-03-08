const fs = require('fs');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');
const { promisify } = require('util');
const path = require('path');

const parseNBT = promisify(nbt.parse);

async function convertMinecraftToHytopia(mcMapPath, outputPath) {
    try {
        // Initialize Hytopia map structure
        const hytopiaMap = {
            blockTypes: [
                {
                    id: 1,
                    name: "Stone",
                    textureUri: "textures/blocks/stone.png"
                }
            ],
            blocks: {}
        };

        // Read and decompress the Minecraft .dat file with debug logging
        console.log('Reading file...');
        const compressedData = fs.readFileSync(mcMapPath);
        console.log('Compressed data length:', compressedData.length);
        
        console.log('Decompressing...');
        const decompressedData = zlib.gunzipSync(compressedData);
        console.log('Decompressed data length:', decompressedData.length);
        
        // Parse NBT data with debug logging
        console.log('Parsing NBT...');
        try {
            // Try alternative parsing approach
            nbt.parse(decompressedData, (error, data) => {
                if (error) {
                    console.error('NBT Parse Error:', error);
                    return;
                }
                
                console.log('NBT Data Structure:');
                console.log(JSON.stringify(data, null, 2));
                
                // Access the map data
                const mapData = data?.value?.data?.value;
                
                if (mapData && mapData.colors?.value) {
                    const colors = mapData.colors.value;
                    const xCenter = mapData.xCenter?.value || 0;
                    const zCenter = mapData.zCenter?.value || 0;
                    const scale = Math.pow(2, mapData.scale?.value || 0);

                    // Convert each pixel to blocks
                    for (let x = 0; x < 128; x++) {
                        for (let z = 0; z < 128; z++) {
                            const index = z * 128 + x;
                            const color = colors[index];
                            
                            if (color === 0) continue;

                            const height = Math.max(1, Math.floor(color / 4));
                            const worldX = xCenter + (x - 64) * scale;
                            const worldZ = zCenter + (z - 64) * scale;

                            for (let y = 0; y < height; y++) {
                                const key = `${worldX},${y},${worldZ}`;
                                hytopiaMap.blocks[key] = 1;
                            }
                        }
                    }

                    // Save the converted map
                    fs.writeFileSync(
                        outputPath,
                        JSON.stringify(hytopiaMap, null, 2)
                    );

                    console.log(`Conversion complete! Saved to ${outputPath}`);
                    console.log(`Processed ${Object.keys(hytopiaMap.blocks).length} blocks`);
                }
            });

        } catch (nbtError) {
            console.error('NBT Parsing error:', nbtError);
            console.log('First 100 bytes of decompressed data:', decompressedData.slice(0, 100));
            throw nbtError;
        }

    } catch (error) {
        console.error('Error during conversion:', error);
        throw error;
    }
}

// Usage example
async function main() {
    try {
        // Get command line arguments
        const inputPath = process.argv[2];
        const outputPath = process.argv[3];

        if (!inputPath || !outputPath) {
            console.error('Usage: node convertMap2.js <input_path> <output_path>');
            process.exit(1);
        }

        // Fix path handling
        const mcMapPath = path.join(process.cwd(), inputPath, 'map_2006.dat');
        const outputFilePath = path.join(process.cwd(), outputPath);

        console.log('Reading from:', mcMapPath);
        console.log('Writing to:', outputFilePath);

        await convertMinecraftToHytopia(mcMapPath, outputFilePath);
    } catch (error) {
        console.error('Failed to convert map:', error);
    }
}

main();