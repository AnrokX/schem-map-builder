import React, { useState, useEffect } from 'react';
import { processCustomBlock } from '../TerrainBuilder';
import { finalizeSchematicImport } from '../SchematicConverter';
import { FaUpload, FaCheck, FaTimes, FaTrash } from 'react-icons/fa';
import Tooltip from './Tooltip';
import './BlockImportModal.css';

// Helper function to get block name for display
const getDisplayName = (blockName) => {
  // Remove minecraft: prefix and convert underscores to spaces
  return blockName
    .replace('minecraft:', '')
    .replace(/_/g, ' ')
    .split('[')[0] // Remove any block states
    .trim();
};

const BlockImportModal = ({ 
  isOpen, 
  onClose, 
  unmappedBlocks,
  temporaryBlockMap,
  terrainBuilderRef,
  onImportComplete 
}) => {
  const [blockDecisions, setBlockDecisions] = useState({});
  const [loading, setLoading] = useState(false);
  const [applyToSimilar, setApplyToSimilar] = useState(false);
  const [previewImages, setPreviewImages] = useState({});
  const [selectedTab, setSelectedTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [progress, setProgress] = useState(0);
  
  // Prepare block decisions on initial load
  useEffect(() => {
    if (isOpen && unmappedBlocks) {
      const initialDecisions = {};
      Object.keys(unmappedBlocks).forEach(blockName => {
        initialDecisions[blockName] = { action: 'useFallback' };
      });
      setBlockDecisions(initialDecisions);
    }
  }, [isOpen, unmappedBlocks]);
  
  // Filter blocks based on selected tab and search query
  const filteredBlocks = () => {
    if (!unmappedBlocks) return [];
    
    let blocks = Object.entries(unmappedBlocks).map(([name, info]) => ({
      name,
      ...info
    }));
    
    // Apply tab filter
    if (selectedTab === 'pending') {
      blocks = blocks.filter(block => 
        !blockDecisions[block.name] || 
        blockDecisions[block.name].action === 'useFallback'
      );
    } else if (selectedTab === 'custom') {
      blocks = blocks.filter(block => 
        blockDecisions[block.name] && 
        blockDecisions[block.name].action === 'useCustomTexture'
      );
    } else if (selectedTab === 'skipped') {
      blocks = blocks.filter(block => 
        blockDecisions[block.name] && 
        blockDecisions[block.name].action === 'skip'
      );
    }
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      blocks = blocks.filter(block => 
        getDisplayName(block.name).toLowerCase().includes(query)
      );
    }
    
    // Sort by block count (most frequent first)
    return blocks.sort((a, b) => b.count - a.count);
  };
  
  // Handle file upload for custom texture
  const handleTextureUpload = async (blockName, e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    try {
      // Read the selected image file
      const reader = new FileReader();
      reader.onload = async (event) => {
        const textureUri = event.target.result;
        
        // Update preview image
        setPreviewImages(prev => ({
          ...prev,
          [blockName]: textureUri
        }));
        
        // Create a custom block with this texture
        const customBlockName = getDisplayName(blockName);
        const customBlock = {
          name: customBlockName,
          textureUri,
          isMultiTexture: false,
          sideTextures: {}
        };
        
        // Process the custom block to get an ID
        processCustomBlock(customBlock);
        
        // Find the newly created block to get its ID
        const customBlockId = window.getCustomBlockId?.(customBlockName) || null;
        
        if (customBlockId) {
          // Update decision for this block
          updateBlockDecision(blockName, 'useCustomTexture', { customBlockId });
          
          // If apply to similar is enabled, find similar blocks
          if (applyToSimilar) {
            applySimilarBlocks(blockName, 'useCustomTexture', { customBlockId });
          }
        } else {
          console.error("Failed to process custom block", customBlockName);
        }
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error("Error processing texture upload:", error);
    }
  };
  
  // Update decision for a specific block
  const updateBlockDecision = (blockName, action, extraData = {}) => {
    setBlockDecisions(prev => ({
      ...prev,
      [blockName]: { action, ...extraData }
    }));
  };
  
  // Apply the same decision to similar blocks
  const applySimilarBlocks = (blockName, action, extraData = {}) => {
    // Find blocks with similar names (without state data)
    const baseName = blockName.split('[')[0];
    const similarBlocks = Object.keys(unmappedBlocks).filter(name => 
      name !== blockName && name.startsWith(baseName)
    );
    
    if (similarBlocks.length > 0) {
      const newDecisions = { ...blockDecisions };
      similarBlocks.forEach(name => {
        newDecisions[name] = { action, ...extraData };
      });
      setBlockDecisions(newDecisions);
    }
  };
  
  // Handle import finalization
  const handleConfirmImport = async () => {
    try {
      setLoading(true);
      
      // Process blocks with progress updates
      const totalBlocks = Object.keys(blockDecisions).length;
      let processed = 0;
      
      // Finalize the import with all decisions
      const result = await finalizeSchematicImport(
        temporaryBlockMap,
        unmappedBlocks,
        blockDecisions,
        terrainBuilderRef
      );
      
      // Call the completion callback
      if (onImportComplete) {
        onImportComplete(result);
      }
      
      // Close the modal
      onClose();
    } catch (error) {
      console.error("Error finalizing import:", error);
      alert("Error importing schematic: " + error.message);
    } finally {
      setLoading(false);
    }
  };
  
  // Don't render if modal is not open
  if (!isOpen) return null;
  
  return (
    <div className="block-import-modal-overlay">
      <div className="block-import-modal">
        <div className="block-import-modal-header">
          <h2>Block Texture Selection</h2>
          <button className="close-button" onClick={onClose} disabled={loading}>
            <FaTimes />
          </button>
        </div>
        
        <div className="block-import-modal-info">
          <p>The schematic contains {Object.keys(unmappedBlocks || {}).length} block types without matching textures in HYTOPIA. 
            For each block, you can:</p>
          <ul>
            <li><strong>Use Fallback:</strong> Apply the automatic fallback texture</li>
            <li><strong>Upload Texture:</strong> Provide a custom texture</li>
            <li><strong>Skip Block:</strong> Remove this block type from the import</li>
          </ul>
        </div>
        
        <div className="block-import-modal-filters">
          <div className="tabs">
            <button 
              className={selectedTab === 'all' ? 'active' : ''} 
              onClick={() => setSelectedTab('all')}
            >
              All Blocks
            </button>
            <button 
              className={selectedTab === 'pending' ? 'active' : ''} 
              onClick={() => setSelectedTab('pending')}
            >
              Using Fallback
            </button>
            <button 
              className={selectedTab === 'custom' ? 'active' : ''} 
              onClick={() => setSelectedTab('custom')}
            >
              Custom Texture
            </button>
            <button 
              className={selectedTab === 'skipped' ? 'active' : ''} 
              onClick={() => setSelectedTab('skipped')}
            >
              Skipped
            </button>
          </div>
          
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search blocks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <label className="apply-similar-checkbox">
            <input
              type="checkbox"
              checked={applyToSimilar}
              onChange={(e) => setApplyToSimilar(e.target.checked)}
            />
            Apply to similar blocks (e.g., same block with different states)
          </label>
        </div>
        
        <div className="block-list">
          {filteredBlocks().map((block) => (
            <div key={block.name} className="block-item">
              <div className="block-info">
                <h3>{getDisplayName(block.name)}</h3>
                <p className="block-count">{block.count} blocks in schematic</p>
                
                <div className="block-preview-container">
                  <div className="fallback-preview">
                    <p>Fallback Texture:</p>
                    <div 
                      className="texture-preview"
                      style={{
                        backgroundImage: `url(${window.getFallbackTextureUrl?.(block.fallbackId) || './assets/blocks/error.png'})`
                      }}
                    />
                  </div>
                  
                  {blockDecisions[block.name]?.action === 'useCustomTexture' && (
                    <div className="custom-preview">
                      <p>Custom Texture:</p>
                      <div 
                        className="texture-preview"
                        style={{
                          backgroundImage: `url(${previewImages[block.name] || './assets/blocks/error.png'})`
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
              
              <div className="block-actions">
                <Tooltip text="Use Fallback Texture">
                  <button 
                    className={`action-button ${blockDecisions[block.name]?.action === 'useFallback' ? 'active' : ''}`}
                    onClick={() => updateBlockDecision(block.name, 'useFallback')}
                  >
                    <FaCheck />
                  </button>
                </Tooltip>
                
                <Tooltip text="Upload Custom Texture">
                  <label className={`action-button ${blockDecisions[block.name]?.action === 'useCustomTexture' ? 'active' : ''}`}>
                    <FaUpload />
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleTextureUpload(block.name, e)}
                      style={{ display: 'none' }}
                    />
                  </label>
                </Tooltip>
                
                <Tooltip text="Skip This Block">
                  <button 
                    className={`action-button ${blockDecisions[block.name]?.action === 'skip' ? 'active' : ''}`}
                    onClick={() => updateBlockDecision(block.name, 'skip')}
                  >
                    <FaTrash />
                  </button>
                </Tooltip>
              </div>
            </div>
          ))}
          
          {filteredBlocks().length === 0 && (
            <div className="no-blocks-message">
              <p>No blocks match your current filters.</p>
            </div>
          )}
        </div>
        
        <div className="block-import-modal-footer">
          {loading && (
            <div className="progress-bar">
              <div className="progress" style={{ width: `${progress}%` }}></div>
            </div>
          )}
          
          <button 
            className="confirm-button"
            onClick={handleConfirmImport}
            disabled={loading}
          >
            Confirm Choices & Import
          </button>
        </div>
      </div>
    </div>
  );
};

export default BlockImportModal; 