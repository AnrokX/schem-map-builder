#!/usr/bin/env python3
import os
import sys
import gzip
import json
import datetime
import nbtlib
import traceback
from pathlib import Path
from io import BytesIO

def safe_to_string(value):
    """Safely converts a value that might be a large number to a string"""
    if isinstance(value, (int, float)):
        return str(value)
    return str(value)

def format_coordinates(obj):
    """Safely formats an NBT object that might contain coordinates"""
    if not obj or not isinstance(obj, dict):
        return 'unknown'
    
    try:
        x = safe_to_string(obj.get('x', '?'))
        y = safe_to_string(obj.get('y', '?'))
        z = safe_to_string(obj.get('z', '?'))
        return f"{x} x {y} x {z}"
    except Exception as e:
        return f'error parsing coordinates: {str(e)}'

def format_timestamp(timestamp):
    """Format a timestamp as a readable date"""
    try:
        if isinstance(timestamp, (int, float)):
            date = datetime.datetime.fromtimestamp(timestamp / 1000)  # Minecraft timestamps are in milliseconds
            return f"{timestamp} ({date.strftime('%Y-%m-%d %H:%M:%S')})"
        return safe_to_string(timestamp)
    except Exception as e:
        return f"{timestamp} (error formatting date: {str(e)})"

def safe_check(obj, key):
    """Safely check if a key exists in an object"""
    try:
        return key in obj
    except:
        return False

def analyze_schematic(file_path, output_file=None):
    """
    Analyzes a Minecraft schematic file and returns the information
    
    Args:
        file_path: Path to the schematic file
        output_file: Optional file to write the output to
    
    Returns:
        dict: Information about the schematic file
    """
    result = {
        "file_name": os.path.basename(file_path),
        "file_path": str(file_path),
        "file_size": os.path.getsize(file_path),
        "analysis_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    
    output = []
    output.append(f"\n=== Analyzing file: {os.path.basename(file_path)} ===")
    output.append(f"File path: {file_path}")
    output.append(f"File size: {os.path.getsize(file_path)} bytes")
    
    try:
        # Read the file
        with open(file_path, 'rb') as f:
            raw_data = f.read()
        
        # Check if the file is gzipped
        is_gzipped = raw_data[0] == 0x1f and raw_data[1] == 0x8b
        output.append(f"File compression: {'gzipped' if is_gzipped else 'not gzipped'}")
        result["compression"] = "gzipped" if is_gzipped else "not gzipped"
        
        # Decompress if needed
        if is_gzipped:
            try:
                file_data = gzip.decompress(raw_data)
                output.append(f"Decompressed size: {len(file_data)} bytes")
                result["decompressed_size"] = len(file_data)
            except Exception as e:
                output.append(f"Error decompressing file: {str(e)}")
                result["error"] = f"Error decompressing file: {str(e)}"
                return result, "\n".join(output)
        else:
            file_data = raw_data
        
        # Parse the NBT data
        try:
            # Use BytesIO to create a file-like object
            file_obj = BytesIO(file_data)
            nbt_data = nbtlib.File.parse(file_obj)
            output.append(f"NBT format: {nbt_data.gzipped}")
        except Exception as e:
            output.append(f"Error parsing NBT data: {str(e)}")
            result["error"] = f"Error parsing NBT data: {str(e)}"
            return result, "\n".join(output)
        
        # Get the root structure
        schematic = nbt_data.get('Schematic', nbt_data)
        
        # Determine the format
        format_type = "unknown"
        
        # Check for modern WorldEdit format (.schem)
        if safe_check(schematic, 'Palette') and safe_check(schematic, 'BlockData'):
            format_type = "modern_worldedit"
        # Check for nested modern WorldEdit format
        elif safe_check(schematic, 'Blocks') and isinstance(schematic.get('Blocks'), dict) and safe_check(schematic.get('Blocks', {}), 'Palette'):
            format_type = "modern_worldedit_nested"
        # Check for alternate modern format
        elif safe_check(schematic, 'BlockData') or safe_check(schematic, 'blocks'):
            format_type = "modern_alternate"
        # Check for classic WorldEdit format (.schematic)
        elif safe_check(schematic, 'Blocks') and safe_check(schematic, 'Data'):
            format_type = "classic_worldedit"
        # Check for litematica format (.litematic)
        elif safe_check(schematic, 'Regions'):
            format_type = "litematica"
        
        output.append(f"Format: {format_type}")
        result["format"] = format_type
        
        # Display dimensions
        if format_type == "litematica":
            # Litematica format has regions with their own dimensions
            output.append("\nRegions:")
            result["regions"] = {}
            
            regions = schematic.get('Regions', {})
            for region_name, region in regions.items():
                output.append(f"  - {region_name}:")
                region_info = {}
                
                # Size and Position
                if safe_check(region, 'Size'):
                    size = region['Size']
                    size_str = f"{size.get('x', '?')} x {size.get('y', '?')} x {size.get('z', '?')}"
                    output.append(f"    Size: {size_str}")
                    region_info["size"] = size_str
                
                if safe_check(region, 'Position'):
                    pos = region['Position']
                    pos_str = f"{pos.get('x', '?')} x {pos.get('y', '?')} x {pos.get('z', '?')}"
                    output.append(f"    Position: ({pos_str})")
                    region_info["position"] = pos_str
                
                # Add block entity information if available
                if safe_check(region, 'BlockEntities'):
                    block_entities = region['BlockEntities']
                    if block_entities:
                        output.append(f"    Block Entities: {len(block_entities)}")
                        region_info["block_entities_count"] = len(block_entities)
                
                # Add entity information if available
                if safe_check(region, 'Entities'):
                    entities = region['Entities']
                    if entities:
                        output.append(f"    Entities: {len(entities)}")
                        region_info["entities_count"] = len(entities)
                
                result["regions"][region_name] = region_info
        else:
            # Other formats have direct width/height/length
            width = schematic.get('Width', schematic.get('width', 0))
            height = schematic.get('Height', schematic.get('height', 0))
            length = schematic.get('Length', schematic.get('length', 0))
            
            dimensions = f"{width} x {height} x {length}"
            output.append(f"Dimensions: {dimensions}")
            total_volume = width * height * length if width and height and length else 0
            output.append(f"Total volume: {total_volume} blocks")
            
            result["dimensions"] = {
                "width": width,
                "height": height,
                "length": length,
                "total_volume": total_volume
            }
        
        # Display block statistics
        if format_type.startswith("modern_worldedit"):
            # Modern WorldEdit format (.schem)
            if safe_check(schematic, 'Palette'):
                palette = schematic['Palette']
                block_count = len(palette)
                output.append(f"\nBlock types: {block_count}")
                output.append("All block types:")
                
                block_types = []
                try:
                    for block_name, block_id in palette.items():
                        output.append(f"  - {block_name} (ID: {block_id})")
                        block_types.append({"name": block_name, "id": block_id})
                except Exception as e:
                    output.append(f"Error listing block types: {str(e)}")
                
                result["block_stats"] = {
                    "total_block_types": block_count,
                    "blocks": block_types
                }
                
                # Add BlockData information
                if safe_check(schematic, 'BlockData'):
                    block_data = schematic['BlockData']
                    if hasattr(block_data, '__len__'):
                        output.append(f"\nBlock data size: {len(block_data)} bytes")
                        result["block_data_size"] = len(block_data)
        elif format_type == "classic_worldedit":
            # Classic WorldEdit format (.schematic)
            output.append("\nBlock data available (classic format)")
            if safe_check(schematic, 'Blocks'):
                # Handle different types of Blocks data
                blocks = schematic['Blocks']
                try:
                    if hasattr(blocks, 'shape') and blocks.shape:
                        # It's a numpy array
                        total_blocks = blocks.size
                    elif hasattr(blocks, '__len__'):
                        # It's a list or similar
                        total_blocks = len(blocks)
                    else:
                        total_blocks = "unknown"
                except:
                    total_blocks = "unknown (error determining size)"
                
                output.append(f"Total blocks: {total_blocks}")
                result["block_stats"] = {
                    "total_blocks": total_blocks
                }
                
                # Add Data information
                if safe_check(schematic, 'Data'):
                    data = schematic['Data']
                    if hasattr(data, '__len__'):
                        output.append(f"Block data size: {len(data)} bytes")
                        result["block_data_size"] = len(data)
                
                # Add TileEntities information
                if safe_check(schematic, 'TileEntities'):
                    tile_entities = schematic['TileEntities']
                    if hasattr(tile_entities, '__len__'):
                        output.append(f"Tile entities: {len(tile_entities)}")
                        result["tile_entities_count"] = len(tile_entities)
                
                # Add Entities information
                if safe_check(schematic, 'Entities'):
                    entities = schematic['Entities']
                    if hasattr(entities, '__len__'):
                        output.append(f"Entities: {len(entities)}")
                        result["entities_count"] = len(entities)
        elif format_type == "litematica":
            # Litematica format
            output.append("\nBlock data available in regions")
        
        # Display metadata if available
        if safe_check(schematic, 'Metadata'):
            output.append("\nMetadata:")
            result["metadata"] = {}
            
            metadata = schematic['Metadata']
            for key, value in metadata.items():
                # Skip WorldEdit metadata as we'll handle it separately
                if key == 'WorldEdit':
                    continue
                
                # Handle object values properly
                if key == 'EnclosingSize' and isinstance(value, dict):
                    coord_str = format_coordinates(value)
                    output.append(f"  {key}: {coord_str}")
                    result["metadata"][key] = coord_str
                elif key in ('TimeCreated', 'TimeModified'):
                    # Format timestamps as dates
                    time_str = format_timestamp(value)
                    output.append(f"  {key}: {time_str}")
                    result["metadata"][key] = time_str
                elif isinstance(value, dict):
                    output.append(f"  {key}: [complex object]")
                    # Try to extract more information from the complex object
                    try:
                        output.append(f"    Keys: {', '.join(value.keys())}")
                        result["metadata"][key] = {"keys": list(value.keys())}
                    except:
                        result["metadata"][key] = "complex object"
                else:
                    output.append(f"  {key}: {safe_to_string(value)}")
                    result["metadata"][key] = safe_to_string(value)
        
        # Handle WorldEdit metadata separately
        if safe_check(schematic, 'Metadata') and safe_check(schematic['Metadata'], 'WorldEdit'):
            output.append("\nWorldEdit Metadata:")
            result["worldedit_metadata"] = {}
            
            we_metadata = schematic['Metadata']['WorldEdit']
            for key, value in we_metadata.items():
                if key == 'Origin' and isinstance(value, dict):
                    coord_str = format_coordinates(value)
                    output.append(f"  {key}: {coord_str}")
                    result["worldedit_metadata"][key] = coord_str
                elif isinstance(value, dict):
                    output.append(f"  {key}: [complex object]")
                    # Try to extract more information from the complex object
                    try:
                        output.append(f"    Keys: {', '.join(value.keys())}")
                        result["worldedit_metadata"][key] = {"keys": list(value.keys())}
                    except:
                        result["worldedit_metadata"][key] = "complex object"
                else:
                    output.append(f"  {key}: {safe_to_string(value)}")
                    result["worldedit_metadata"][key] = safe_to_string(value)
        
        # Add additional NBT data information
        output.append("\nAdditional NBT Data:")
        additional_keys = []
        for key in schematic.keys():
            if key not in ['Palette', 'BlockData', 'Blocks', 'Data', 'Regions', 'Metadata']:
                additional_keys.append(key)
                value = schematic[key]
                if isinstance(value, dict):
                    output.append(f"  {key}: [complex object]")
                    try:
                        output.append(f"    Keys: {', '.join(value.keys())}")
                    except:
                        pass
                else:
                    output.append(f"  {key}: {safe_to_string(value)}")
        
        if not additional_keys:
            output.append("  No additional NBT data found")
        else:
            result["additional_nbt_keys"] = additional_keys
        
        output.append("\n=== End of analysis ===")
        
    except Exception as e:
        error_msg = f"Error analyzing file: {str(e)}"
        output.append(error_msg)
        # Add traceback for debugging
        output.append(traceback.format_exc())
        result["error"] = error_msg
    
    # Write to output file if specified
    if output_file:
        with open(output_file, 'a', encoding='utf-8') as f:
            f.write("\n".join(output) + "\n\n")
    
    return result, "\n".join(output)

def process_directory(dir_path, output_file=None, json_output=None):
    """Process all supported files in a directory"""
    try:
        dir_path = Path(dir_path)
        if not dir_path.exists() or not dir_path.is_dir():
            print(f"Directory not found: {dir_path}")
            return
        
        supported_extensions = ['.schem', '.schematic', '.litematic']
        files = [f for f in dir_path.iterdir() if f.is_file() and f.suffix.lower() in supported_extensions]
        
        if not files:
            print(f"No supported files found in {dir_path}")
            return
        
        print(f"Found {len(files)} supported files in {dir_path}")
        
        results = []
        for file_path in files:
            result, output_text = analyze_schematic(file_path, output_file)
            # Print the output to the terminal
            print(output_text)
            results.append(result)
        
        # Write JSON output if specified
        if json_output:
            with open(json_output, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=2)
            print(f"JSON data written to {json_output}")
        
    except Exception as e:
        print(f"Error processing directory: {str(e)}")
        print(traceback.format_exc())

def main():
    """Main function to handle command line arguments"""
    if len(sys.argv) < 2:
        print("Usage: python schemInfoPy.py <file_path_or_directory> [--log <log_file>] [--json <json_file>] [--full]")
        print("Supported formats: .schem, .schematic, .litematic")
        sys.exit(1)
    
    file_path = sys.argv[1]
    
    # Parse optional arguments
    log_file = None
    json_file = None
    
    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == "--log" and i + 1 < len(sys.argv):
            log_file = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == "--json" and i + 1 < len(sys.argv):
            json_file = sys.argv[i + 1]
            i += 2
        else:
            i += 1
    
    # Create default log file if not specified
    if log_file is None:
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file = f"schematic_analysis_{timestamp}.log"
    
    # Create default JSON file if not specified
    if json_file is None and log_file:
        json_file = log_file.rsplit('.', 1)[0] + ".json"
    
    # Clear the log file if it exists
    if log_file:
        with open(log_file, 'w', encoding='utf-8') as f:
            f.write(f"Schematic Analysis Log - {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Command: {' '.join(sys.argv)}\n\n")
    
    # Process file or directory
    path = Path(file_path)
    if path.is_dir():
        process_directory(path, log_file, json_file)
    elif path.is_file():
        result, output_text = analyze_schematic(path, log_file)
        # Print the output to the terminal
        print(output_text)
        
        # Write JSON output if specified
        if json_file:
            with open(json_file, 'w', encoding='utf-8') as f:
                json.dump([result], f, indent=2)
            print(f"JSON data written to {json_file}")
    else:
        print(f"File or directory not found: {file_path}")

# Add a function to print detailed information about a specific block type
def print_block_details(block_name, block_data):
    """Print detailed information about a specific block type"""
    print(f"\nDetailed information for block: {block_name}")
    print(f"Block ID: {block_data}")
    # Add more details as needed

if __name__ == "__main__":
    main() 