import React, { useState, useEffect } from 'react';
import { FaTimes, FaCrop } from 'react-icons/fa';
import './BlockImportModal.css'; // Reuse the same CSS for consistency

const RegionSelectionModal = ({ 
  isOpen, 
  onClose, 
  onSelectRegion,
  dimensions,
  centerOffset
}) => {
  // Initialize with the full dimensions of the schematic
  const [minX, setMinX] = useState(-Math.floor(dimensions?.width / 2) || 0);
  const [minY, setMinY] = useState(0);
  const [minZ, setMinZ] = useState(-Math.floor(dimensions?.length / 2) || 0);
  
  const [maxX, setMaxX] = useState(Math.ceil(dimensions?.width / 2) - 1 || 0);
  const [maxY, setMaxY] = useState((dimensions?.height || 0) - 1);
  const [maxZ, setMaxZ] = useState(Math.ceil(dimensions?.length / 2) - 1 || 0);
  
  const [useFullMap, setUseFullMap] = useState(true);
  
  // Update bounds when dimensions change
  useEffect(() => {
    if (dimensions) {
      const centerX = centerOffset?.x || 0;
      const centerY = centerOffset?.y || 0;
      const centerZ = centerOffset?.z || 0;
      
      setMinX(-Math.floor(dimensions.width / 2) + centerX);
      setMinY(0 + centerY);
      setMinZ(-Math.floor(dimensions.length / 2) + centerZ);
      
      setMaxX(Math.ceil(dimensions.width / 2) - 1 + centerX);
      setMaxY((dimensions.height || 0) - 1 + centerY);
      setMaxZ(Math.ceil(dimensions.length / 2) - 1 + centerZ);
    }
  }, [dimensions, centerOffset]);
  
  // Calculate total blocks in the selected region
  const calculateBlockCount = () => {
    if (useFullMap || !dimensions) return "all";
    
    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const depth = maxZ - minZ + 1;
    
    return width * height * depth;
  };
  
  const handleConfirm = () => {
    if (useFullMap) {
      // Use the full map (no region selection)
      onSelectRegion(null);
    } else {
      // Validate that min is less than max for all coordinates
      if (minX > maxX || minY > maxY || minZ > maxZ) {
        alert("Invalid region selection: minimum values must be less than maximum values.");
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
              <div className="coordinate-group">
                <h3>Minimum Coordinates</h3>
                <div className="coordinate-inputs">
                  <div className="coordinate-input">
                    <label>X Min:</label>
                    <input 
                      type="number" 
                      value={minX} 
                      onChange={(e) => setMinX(parseInt(e.target.value))} 
                    />
                  </div>
                  <div className="coordinate-input">
                    <label>Y Min:</label>
                    <input 
                      type="number" 
                      value={minY} 
                      onChange={(e) => setMinY(parseInt(e.target.value))} 
                    />
                  </div>
                  <div className="coordinate-input">
                    <label>Z Min:</label>
                    <input 
                      type="number" 
                      value={minZ} 
                      onChange={(e) => setMinZ(parseInt(e.target.value))} 
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
                      onChange={(e) => setMaxX(parseInt(e.target.value))} 
                    />
                  </div>
                  <div className="coordinate-input">
                    <label>Y Max:</label>
                    <input 
                      type="number" 
                      value={maxY} 
                      onChange={(e) => setMaxY(parseInt(e.target.value))} 
                    />
                  </div>
                  <div className="coordinate-input">
                    <label>Z Max:</label>
                    <input 
                      type="number" 
                      value={maxZ} 
                      onChange={(e) => setMaxZ(parseInt(e.target.value))} 
                    />
                  </div>
                </div>
              </div>
              
              <div className="region-stats">
                <p>
                  Selected region: {Math.abs(maxX - minX) + 1} x {Math.abs(maxY - minY) + 1} x {Math.abs(maxZ - minZ) + 1} blocks
                </p>
                <p>
                  Total blocks in region: {calculateBlockCount()}
                </p>
              </div>
            </div>
          )}
        </div>
        
        <div className="block-import-modal-footer">
          <button 
            className="confirm-button" 
            onClick={handleConfirm}
          >
            <FaCrop /> {useFullMap ? "Import Full Map" : "Import Selected Region"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegionSelectionModal; 