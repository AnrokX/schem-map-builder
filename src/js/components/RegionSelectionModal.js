import React, { useState, useEffect, useCallback } from 'react';
import { FaTimes, FaCrop } from 'react-icons/fa';
import './BlockImportModal.css'; // Reuse the same CSS for consistency

const RegionSelectionModal = ({ 
  isOpen, 
  onClose, 
  onSelectRegion,
  dimensions,
  centerOffset,
  actualBlockCount
}) => {
  // Define the boundary limits based on dimensions and centerOffset
  const minXBoundary = dimensions ? -Math.floor(dimensions.width / 2) + (centerOffset?.x || 0) : 0;
  const minYBoundary = dimensions ? 0 + (centerOffset?.y || 0) : 0;
  const minZBoundary = dimensions ? -Math.floor(dimensions.length / 2) + (centerOffset?.z || 0) : 0;
  
  const maxXBoundary = dimensions ? Math.ceil(dimensions.width / 2) - 1 + (centerOffset?.x || 0) : 0;
  const maxYBoundary = dimensions ? (dimensions.height || 0) - 1 + (centerOffset?.y || 0) : 0;
  const maxZBoundary = dimensions ? Math.ceil(dimensions.length / 2) - 1 + (centerOffset?.z || 0) : 0;

  // Initialize with the full dimensions of the schematic
  const [minX, setMinX] = useState(minXBoundary);
  const [minY, setMinY] = useState(minYBoundary);
  const [minZ, setMinZ] = useState(minZBoundary);
  
  const [maxX, setMaxX] = useState(maxXBoundary);
  const [maxY, setMaxY] = useState(maxYBoundary);
  const [maxZ, setMaxZ] = useState(maxZBoundary);
  
  const [useFullMap, setUseFullMap] = useState(true);
  const [validationError, setValidationError] = useState('');
  
  // Function to ensure a value is within boundaries
  const clampValue = useCallback((value, min, max) => {
    return Math.min(Math.max(value, min), max);
  }, []);

  // Update bounds when dimensions change
  useEffect(() => {
    if (dimensions) {
      setMinX(minXBoundary);
      setMinY(minYBoundary);
      setMinZ(minZBoundary);
      
      setMaxX(maxXBoundary);
      setMaxY(maxYBoundary);
      setMaxZ(maxZBoundary);
    }
  }, [dimensions, centerOffset, minXBoundary, minYBoundary, minZBoundary, maxXBoundary, maxYBoundary, maxZBoundary]);
  
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
  
  // Calculate total blocks in the selected region (excluding air blocks)
  const calculateBlockCount = () => {
    if (useFullMap || !dimensions) return actualBlockCount || "all";
    
    // If we don't have the actual block count, return unknown
    if (!actualBlockCount) return "unknown";
    
    // If the full dimension is selected, return the total count
    if (
      minX === minXBoundary &&
      minY === minYBoundary &&
      minZ === minZBoundary &&
      maxX === maxXBoundary &&
      maxY === maxYBoundary &&
      maxZ === maxZBoundary
    ) {
      return actualBlockCount;
    }
    
    // For partial selections, estimate the block count based on volume ratio
    const totalVolume = dimensions.width * dimensions.height * dimensions.length;
    const selectedVolume = (maxX - minX + 1) * (maxY - minY + 1) * (maxZ - minZ + 1);
    const ratio = selectedVolume / totalVolume;
    
    // Estimation may not be perfectly accurate due to uneven block distribution
    return Math.round(actualBlockCount * ratio);
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
      <div className="block-import-modal">
        <div className="block-import-modal-header">
          <h2>Select Region to Import</h2>
          <button className="close-button" onClick={onClose}>
            <FaTimes />
          </button>
        </div>
        
        <div className="block-import-modal-info">
          <p>Select a specific region of the schematic to import, or import the entire schematic.</p>
          <p>Full schematic dimensions: {dimensions?.width || 0} x {dimensions?.height || 0} x {dimensions?.length || 0} blocks</p>
          <p>Total blocks (excluding air): <strong>{actualBlockCount || "Unknown"}</strong></p>
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