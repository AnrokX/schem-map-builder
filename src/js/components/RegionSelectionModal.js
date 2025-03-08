import React, { useState, useEffect, useCallback } from 'react';
import { FaTimes, FaCrop } from 'react-icons/fa';
import './BlockImportModal.css'; // Reuse the same CSS for consistency

const RegionSelectionModal = ({ 
  isOpen, 
  onClose, 
  onSelectRegion,
  dimensions,
  centerOffset,
  actualBlockCount,
  worldInfo // New prop for Minecraft world info
}) => {
  // Check if we're handling a Minecraft world or a schematic
  const isMinecraftWorld = !!worldInfo;
  
  // Define the boundary limits based on dimensions, centerOffset, or worldInfo
  const minXBoundary = isMinecraftWorld ? 
    -1024 : // For Minecraft worlds, use a larger default range
    (dimensions ? -Math.floor(dimensions.width / 2) + (centerOffset?.x || 0) : 0);
    
  const minYBoundary = isMinecraftWorld ? 
    0 : // Minecraft worlds start at Y=0
    (dimensions ? 0 + (centerOffset?.y || 0) : 0);
    
  const minZBoundary = isMinecraftWorld ? 
    -1024 : // For Minecraft worlds, use a larger default range
    (dimensions ? -Math.floor(dimensions.length / 2) + (centerOffset?.z || 0) : 0);
  
  const maxXBoundary = isMinecraftWorld ? 
    1024 : // For Minecraft worlds, use a larger default range
    (dimensions ? Math.ceil(dimensions.width / 2) - 1 + (centerOffset?.x || 0) : 0);
    
  const maxYBoundary = isMinecraftWorld ? 
    256 : // Minecraft worlds typically have a height of 256
    (dimensions ? (dimensions.height || 0) - 1 + (centerOffset?.y || 0) : 0);
    
  const maxZBoundary = isMinecraftWorld ? 
    1024 : // For Minecraft worlds, use a larger default range
    (dimensions ? Math.ceil(dimensions.length / 2) - 1 + (centerOffset?.z || 0) : 0);

  // Initialize with default values
  const [minX, setMinX] = useState(minXBoundary);
  const [minY, setMinY] = useState(minYBoundary);
  const [minZ, setMinZ] = useState(minZBoundary);
  
  const [maxX, setMaxX] = useState(maxXBoundary);
  const [maxY, setMaxY] = useState(maxYBoundary);
  const [maxZ, setMaxZ] = useState(maxZBoundary);

  // If dealing with a Minecraft world, set more reasonable initial values
  useEffect(() => {
    if (isMinecraftWorld && worldInfo) {
      // Use spawn point as center and create a reasonable area around it
      const spawnX = worldInfo.spawnX || 0;
      const spawnY = worldInfo.spawnY || 64;
      const spawnZ = worldInfo.spawnZ || 0;
      
      // Default to a 128x128x128 region around spawn point
      setMinX(spawnX - 64);
      setMinY(Math.max(0, spawnY - 32));
      setMaxY(Math.min(255, spawnY + 96));
      setMinZ(spawnZ - 64);
      
      setMaxX(spawnX + 64);
      setMaxZ(spawnZ + 64);
    }
  }, [isMinecraftWorld, worldInfo]);
  
  const [useFullMap, setUseFullMap] = useState(true);
  const [validationError, setValidationError] = useState('');
  
  // Function to ensure a value is within boundaries
  const clampValue = useCallback((value, min, max) => {
    return Math.min(Math.max(value, min), max);
  }, []);

  // Update bounds when dimensions change
  useEffect(() => {
    if (dimensions && !isMinecraftWorld) {
      setMinX(minXBoundary);
      setMinY(minYBoundary);
      setMinZ(minZBoundary);
      
      setMaxX(maxXBoundary);
      setMaxY(maxYBoundary);
      setMaxZ(maxZBoundary);
    }
  }, [dimensions, centerOffset, minXBoundary, minYBoundary, minZBoundary, maxXBoundary, maxYBoundary, maxZBoundary, isMinecraftWorld]);
  
  // Handle input changes with validation
  const handleMinXChange = (value) => {
    const parsedValue = parseInt(value);
    if (isNaN(parsedValue)) return;
    
    const clampedValue = clampValue(parsedValue, minXBoundary, maxX);
    setMinX(clampedValue);
    validateCoordinates(clampedValue, maxX, minY, maxY, minZ, maxZ);
  };
  
  const handleMaxXChange = (value) => {
    const parsedValue = parseInt(value);
    if (isNaN(parsedValue)) return;
    
    const clampedValue = clampValue(parsedValue, minX, maxXBoundary);
    setMaxX(clampedValue);
    validateCoordinates(minX, clampedValue, minY, maxY, minZ, maxZ);
  };
  
  const handleMinYChange = (value) => {
    const parsedValue = parseInt(value);
    if (isNaN(parsedValue)) return;
    
    const clampedValue = clampValue(parsedValue, minYBoundary, maxY);
    setMinY(clampedValue);
    validateCoordinates(minX, maxX, clampedValue, maxY, minZ, maxZ);
  };
  
  const handleMaxYChange = (value) => {
    const parsedValue = parseInt(value);
    if (isNaN(parsedValue)) return;
    
    const clampedValue = clampValue(parsedValue, minY, maxYBoundary);
    setMaxY(clampedValue);
    validateCoordinates(minX, maxX, minY, clampedValue, minZ, maxZ);
  };
  
  const handleMinZChange = (value) => {
    const parsedValue = parseInt(value);
    if (isNaN(parsedValue)) return;
    
    const clampedValue = clampValue(parsedValue, minZBoundary, maxZ);
    setMinZ(clampedValue);
    validateCoordinates(minX, maxX, minY, maxY, clampedValue, maxZ);
  };
  
  const handleMaxZChange = (value) => {
    const parsedValue = parseInt(value);
    if (isNaN(parsedValue)) return;
    
    const clampedValue = clampValue(parsedValue, minZ, maxZBoundary);
    setMaxZ(clampedValue);
    validateCoordinates(minX, maxX, minY, maxY, minZ, clampedValue);
  };
  
  // Validate coordinates
  const validateCoordinates = (minX, maxX, minY, maxY, minZ, maxZ) => {
    if (minX > maxX || minY > maxY || minZ > maxZ) {
      setValidationError('Minimum values must be less than maximum values.');
    } else {
      setValidationError('');
    }
  };
  
  // Calculate the estimated block count
  const calculateBlockCount = () => {
    if (useFullMap) {
      // For full map, use actual block count if available 
      return isMinecraftWorld ? 
        worldInfo?.estimatedBlockCount || "Unknown" :
        actualBlockCount || "Unknown";
    } else {
      // For selection, calculate based on coordinates
      const width = Math.abs(maxX - minX) + 1;
      const height = Math.abs(maxY - minY) + 1;
      const length = Math.abs(maxZ - minZ) + 1;
      const volume = width * height * length;
      
      if (isMinecraftWorld) {
        // For Minecraft worlds, we estimate that only about 30% of blocks are non-air
        return Math.round(volume * 0.3);
      } else {
        // For schematics, use the ratio of actual blocks to volume
        const fullVolume = dimensions ? dimensions.width * dimensions.height * dimensions.length : 1;
        const ratio = actualBlockCount ? actualBlockCount / fullVolume : 0.7;
        return Math.round(volume * ratio);
      }
    }
  };
  
  const handleConfirm = () => {
    if (useFullMap) {
      // Use the full map (no region selection)
      onSelectRegion(null);
    } else {
      // Validate that min is less than max for all coordinates
      if (minX > maxX || minY > maxY || minZ > maxZ) {
        setValidationError('Invalid region selection: minimum values must be less than maximum values.');
        return;
      }
      
      // Send the region selection
      onSelectRegion({
        minX, minY, minZ,
        maxX, maxY, maxZ
      });
    }
    onClose();
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="block-import-modal-overlay">
      <div className="block-import-modal region-selection-modal">
        <div className="block-import-modal-header">
          <h2>{isMinecraftWorld ? "Minecraft World Region Selection" : "Schematic Region Selection"}</h2>
          <button className="close-button" onClick={onClose}>
            <FaTimes />
          </button>
        </div>
        
        <div className="block-import-modal-info">
          {isMinecraftWorld ? (
            <div className="minecraft-world-info">
              <h3>World Information</h3>
              <p><strong>Name:</strong> {worldInfo?.name || "Unknown"}</p>
              <p><strong>Version:</strong> {worldInfo?.gameVersion || "Unknown"}</p>
              <p><strong>Region Files:</strong> {worldInfo?.regionCount || "Unknown"}</p>
              <p><strong>Spawn Point:</strong> X: {worldInfo?.spawnX || 0}, Y: {worldInfo?.spawnY || 64}, Z: {worldInfo?.spawnZ || 0}</p>
              <p><strong>Estimated Size:</strong> {worldInfo?.estimatedSize || "Unknown"}</p>
              <p className="warning-text">Warning: Importing a full Minecraft world can be resource-intensive. Consider selecting a smaller region around spawn.</p>
            </div>
          ) : (
            <p>The schematic is {dimensions?.width || "?"} x {dimensions?.height || "?"} x {dimensions?.length || "?"} blocks with {actualBlockCount || "unknown"} actual blocks. You can import the entire schematic or select a region.</p>
          )}
        </div>
        
        <div className="region-selection-container">
          <div className="use-full-map-toggle">
            <label>
              <input 
                type="checkbox" 
                checked={useFullMap} 
                onChange={(e) => setUseFullMap(e.target.checked)} 
              />
              Import entire schematic
            </label>
          </div>
          
          {!useFullMap && (
            <div className="region-coordinates">
              <div className="boundary-info">
                <p>Valid X range: {minXBoundary} to {maxXBoundary}</p>
                <p>Valid Y range: {minYBoundary} to {maxYBoundary}</p>
                <p>Valid Z range: {minZBoundary} to {maxZBoundary}</p>
              </div>
              
              {validationError && (
                <div className="validation-error">
                  {validationError}
                </div>
              )}
              
              <div className="coordinate-group">
                <h3>Minimum Coordinates</h3>
                <div className="coordinate-inputs">
                  <div className="coordinate-input">
                    <label>X Min:</label>
                    <input 
                      type="number" 
                      value={minX} 
                      onChange={(e) => handleMinXChange(e.target.value)}
                      min={minXBoundary}
                      max={maxX}
                    />
                  </div>
                  <div className="coordinate-input">
                    <label>Y Min:</label>
                    <input 
                      type="number" 
                      value={minY} 
                      onChange={(e) => handleMinYChange(e.target.value)}
                      min={minYBoundary}
                      max={maxY}
                    />
                  </div>
                  <div className="coordinate-input">
                    <label>Z Min:</label>
                    <input 
                      type="number" 
                      value={minZ} 
                      onChange={(e) => handleMinZChange(e.target.value)}
                      min={minZBoundary}
                      max={maxZ}
                    />
                  </div>
                </div>
              </div>
              
              <div className="coordinate-group">
                <h3>Maximum Coordinates</h3>
                <div className="coordinate-inputs">
                  <div className="coordinate-input">
                    <label>X Max:</label>
                    <input 
                      type="number" 
                      value={maxX} 
                      onChange={(e) => handleMaxXChange(e.target.value)}
                      min={minX}
                      max={maxXBoundary}
                    />
                  </div>
                  <div className="coordinate-input">
                    <label>Y Max:</label>
                    <input 
                      type="number" 
                      value={maxY} 
                      onChange={(e) => handleMaxYChange(e.target.value)}
                      min={minY}
                      max={maxYBoundary}
                    />
                  </div>
                  <div className="coordinate-input">
                    <label>Z Max:</label>
                    <input 
                      type="number" 
                      value={maxZ} 
                      onChange={(e) => handleMaxZChange(e.target.value)}
                      min={minZ}
                      max={maxZBoundary}
                    />
                  </div>
                </div>
              </div>
              
              <div className="region-stats">
                <p>
                  Selected region: {Math.abs(maxX - minX) + 1} x {Math.abs(maxY - minY) + 1} x {Math.abs(maxZ - minZ) + 1} blocks
                </p>
                <p>
                  Estimated blocks in selection: <strong>{calculateBlockCount()}</strong> (excluding air blocks)
                </p>
                {!useFullMap && calculateBlockCount() !== actualBlockCount && (
                  <p className="region-note">
                    Note: Block count is an estimation based on volume. Actual count may vary depending on block distribution.
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        
        <div className="block-import-modal-footer">
          <button 
            className="confirm-button" 
            onClick={handleConfirm}
            disabled={!!validationError && !useFullMap}
          >
            <FaCrop /> {useFullMap ? "Import Full Map" : "Import Selected Region"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegionSelectionModal; 