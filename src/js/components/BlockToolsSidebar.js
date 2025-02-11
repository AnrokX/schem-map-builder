import React, { useState } from "react";
import { FaUpload, FaCube, FaTree } from "react-icons/fa";
import BlockButton from "./BlockButton";
import EnvironmentButton from "./EnvironmentButton";
import { DatabaseManager, STORES } from '../DatabaseManager';
import { environmentModels } from '../EnvironmentBuilder';
import { updateBlockTypes, blockTypes } from '../TerrainBuilder';
import "../../css/BlockToolsSidebar.css";

const SCALE_MIN = 0.1;
const SCALE_MAX = 5.0;
const ROTATION_MIN = 0;
const ROTATION_MAX = 360;

let selectedBlockID = 0;

const BlockToolsSidebar = ({
  activeTab,
  customBlocks,
  setActiveTab,
  setCustomBlocks,
  setCurrentBlockType,
  environmentBuilder,
  updateTerrainWithHistory,
}) => {
  const [settings, setSettings] = useState({
    randomScale: false,
    randomRotation: false,
    minScale: 0.5,
    maxScale: 1.5,
    minRotation: 0,
    maxRotation: 360,
    scale: 1.0,
    rotation: 0
  });

  const updateSettings = (updates) => {
    const newSettings = { ...settings, ...updates };
    setSettings(newSettings);
  };

  const handleDragStart = (blockId) => {
    console.log("Drag started with block:", blockId);
  };

    // Update the tab switching logic
  const handleTabChange = (newTab) => {
    // Reset current block type to default block when switching to blocks tab
    if (newTab === "blocks") {
        setCurrentBlockType(blockTypes[0]);
    }
    else if (newTab === "environment") {
      setCurrentBlockType(environmentModels[0]);
    }
    setActiveTab(newTab);
  };


  const handleDeleteCustomBlock = async (blockType) => {
    const confirmMessage = `Deleting "${blockType.name}" will remove any block of this type from the scene and CANNOT BE UNDONE! Are you sure you want to proceed?`;
    
    if (window.confirm(confirmMessage)) {
      const updatedBlocks = customBlocks.filter(b => b.id !== blockType.id);
      setCustomBlocks(updatedBlocks);
      
      try {
        await DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', updatedBlocks);
        
        // Update terrain to remove deleted block instances
        const currentTerrain = await DatabaseManager.getData(STORES.TERRAIN, 'current') || {};
        const newTerrain = Object.fromEntries(
          Object.entries(currentTerrain).filter(([_, block]) => block.id !== blockType.id)
        );
        await DatabaseManager.saveData(STORES.TERRAIN, 'current', newTerrain);
        updateTerrainWithHistory(newTerrain);
      } catch (error) {
        console.error('Error updating database after block deletion:', error);
      }
    }
  };

  const handleDeleteEnvironmentModel = async (modelId) => {
    if (window.confirm('Are you sure you want to delete this custom model?')) {
      try {
        const existingModels = await DatabaseManager.getData(STORES.CUSTOM_MODELS, 'models') || [];
        const modelToDelete = environmentModels.find(model => model.id === modelId);
        
        if (!modelToDelete) return;

        const modelIndex = environmentModels.findIndex(model => model.id === modelId);
        if (modelIndex !== -1) {
          environmentModels.splice(modelIndex, 1);
        }

        const updatedModels = existingModels.filter(model => model.name !== modelToDelete.name);
        await DatabaseManager.saveData(STORES.CUSTOM_MODELS, 'models', updatedModels);

        const currentEnvironment = await DatabaseManager.getData(STORES.ENVIRONMENT, 'current') || [];
        const updatedEnvironment = currentEnvironment.filter(obj => obj.name !== modelToDelete.name);

        await DatabaseManager.saveData(STORES.ENVIRONMENT, 'current', updatedEnvironment);
        await environmentBuilder.current?.loadSavedEnvironment();
      } catch (error) {
        console.error('Error deleting environment model:', error);
      }
    }
  };

  const handleEnvironmentSelect = (envType) => {
    console.log("Environment selected:", envType);
    setCurrentBlockType({
      ...envType,
      isEnvironment: true
    });
    selectedBlockID = envType.id;
  };

  const handleBlockSelect = (blockType) => {
    console.log("Block selected:", blockType);
    setCurrentBlockType({
      ...blockType,
      isEnvironment: false
    });
    selectedBlockID = blockType.id;
  };




  const handleDrop = async (e) => {
    e.preventDefault();
    e.currentTarget.classList.remove("drag-over");

    const files = Array.from(e.dataTransfer.files);
    
    if (activeTab === "blocks") {
      const imageFiles = files.filter(file => file.type.startsWith("image/"));

      if (imageFiles.length > 0) {
        for (const file of imageFiles) {
          const reader = new FileReader();
          reader.onload = async () => {
            const fileName = file.name.replace(/\.[^/.]+$/, "");
            const existingBlockIndex = customBlocks.findIndex(block => block.name === fileName);
            
            if (existingBlockIndex !== -1) {
              const updatedBlocks = [...customBlocks];
              updatedBlocks[existingBlockIndex] = {
                ...updatedBlocks[existingBlockIndex],
                textureUri: reader.result
              };
              setCustomBlocks(updatedBlocks);
              updateBlockTypes(updatedBlocks);
              
              try {
                await DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', updatedBlocks);
                alert(`Updated texture for existing block: ${fileName}\n\nPlease refresh the page to see the changes.`);
              } catch (error) {
                console.error('Error updating custom block:', error);
              }
            } else {
              const maxId = Math.max(...customBlocks.map(block => block.id), 99);
              const newBlockType = {
                id: maxId + 1,
                name: fileName,
                textureUri: reader.result,
                isCustom: true,
              };
              
              const updatedBlocks = [...customBlocks, newBlockType];
              setCustomBlocks(updatedBlocks);
              updateBlockTypes(updatedBlocks);
              
              try {
                await DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', updatedBlocks);
              } catch (error) {
                console.error('Error saving custom blocks:', error);
              }
            }
          };
          reader.readAsDataURL(file);
        }
      }
    } else if (activeTab === "environment") {
      const gltfFiles = files.filter(file => file.name.endsWith('.gltf'));

      if (gltfFiles.length > 0) {
        for (const file of gltfFiles) {
          const fileName = file.name.replace(/\.[^/.]+$/, "");
          
          if (environmentModels.some(model => model.name.toLowerCase() === fileName.toLowerCase())) {
            alert(`A model named "${fileName}" already exists. Please rename the file and try again.`);
            continue;
          }

          const reader = new FileReader();
          reader.onload = async () => {
            try {
              const existingModels = await DatabaseManager.getData(STORES.CUSTOM_MODELS, 'models') || [];
              const modelData = {
                name: fileName,
                data: reader.result,
                timestamp: Date.now()
              };

              const updatedModels = [...existingModels, modelData];
              await DatabaseManager.saveData(STORES.CUSTOM_MODELS, 'models', updatedModels);

              const blob = new Blob([reader.result], { type: 'model/gltf+json' });
              const fileUrl = URL.createObjectURL(blob);
              
              const newEnvironmentModel = {
                id: Math.max(...environmentModels.filter(model => model.isCustom).map(model => model.id), 199) + 1,
                name: fileName,
                modelUrl: fileUrl,
                isEnvironment: true,
                isCustom: true,
                animations: ['idle']
              };
              
              environmentModels.push(newEnvironmentModel);
              
              if (environmentBuilder.current) {
                await environmentBuilder.current.loadCustomModel(newEnvironmentModel);
                console.log(`Successfully loaded custom model: ${fileName}`);
              }
            } catch (error) {
              console.error(`Error processing model ${fileName}:`, error);
            }
          };
          reader.readAsArrayBuffer(file);
        }
      }
    }
  };

  return (
    <div className="block-tools-container">
      <div className="dead-space"></div>
      <div className="block-tools-sidebar">
        <div className="block-buttons-grid">
          {activeTab === "blocks" ? (
            <>
              <div style={{ width: "100%", borderBottom: "2px solid #ccc", fontSize: "12px", textAlign: "left" }}>
                Default Blocks (ID: 1-99)
              </div>
              {blockTypes.map((blockType) => (
                <BlockButton
                  key={blockType.id}
                  blockType={blockType}
                  isSelected={selectedBlockID === blockType.id}
                  onSelect={(block) => {
                    handleBlockSelect(block);
                    localStorage.setItem("selectedBlock", block.id);
                  }}
                  onDelete={handleDeleteCustomBlock}
                  handleDragStart={handleDragStart}
                />
              ))}
              <div style={{ width: "100%", borderBottom: "2px solid #ccc", fontSize: "12px", textAlign: "left" }}>
                Custom Blocks (ID: 100-199)
              </div>
              {customBlocks.map((blockType) => (
                <BlockButton
                  key={blockType.id}
                  blockType={blockType}
                  isSelected={selectedBlockID === blockType.id}
                  onSelect={(block) => {
                    handleBlockSelect(block);
                    localStorage.setItem("selectedBlock", block.id);
                  }}
                  onDelete={handleDeleteCustomBlock}
                  handleDragStart={handleDragStart}
                />
              ))}
            </>
          ) : (
            <div className="environment-button-wrapper">
              <div style={{ width: "100%", borderBottom: "2px solid #ccc", fontSize: "12px", textAlign: "left" }}>
                Default Environment Objects (ID: 200-299)
              </div>
              {environmentModels.filter(envType => !envType.isCustom).map((envType) => (
                <EnvironmentButton
                  key={envType.id}
                  envType={envType}
                  isSelected={selectedBlockID === envType.id}
                  onSelect={(envType) => {
                    handleEnvironmentSelect(envType);
                    localStorage.setItem("selectedBlock", envType.id);
                  }}
                  onDelete={handleDeleteEnvironmentModel}
                />

              ))}
              <div style={{ width: "100%", borderBottom: "2px solid #ccc", fontSize: "12px", textAlign: "left", marginTop: "10px" }}>
                Custom Environment Objects (ID: 300+)
              </div>
              {environmentModels.filter(envType => envType.isCustom).map((envType) => (
                <EnvironmentButton
                  key={envType.id}
                  envType={envType}
                  isSelected={selectedBlockID === envType.id}
                  onSelect={(envType) => {
                    handleEnvironmentSelect(envType);
                    localStorage.setItem("selectedBlock", envType.id);
                  }}
                  onDelete={handleDeleteEnvironmentModel}
                />
              ))}
            </div>
          )}
        </div>

        {activeTab === "environment" && (
          <div className="placement-tools">
            <div className="placement-tools-grid">
              <div className="placement-tool full-width">
                <div className="randomize-header">
                  <input 
                    type="checkbox" 
                    id="randomScale"
                    className="placement-checkbox"
                    checked={settings.randomScale}
                    onChange={(e) => updateSettings({ randomScale: e.target.checked })}
                  />
                  <label htmlFor="randomScale">Randomize Scale</label>
                </div>
                <div className="min-max-inputs">
                  <div className="min-max-input">
                    <label>Range: </label>
                    <input 
                      type="number"
                      className="slider-value-input"
                      value={settings.minScale}
                      min={SCALE_MIN}
                      max={SCALE_MAX}
                      step="0.1"
                      disabled={!settings.randomScale}
                      onChange={(e) => updateSettings({ minScale: Number(e.target.value) })}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value < SCALE_MIN || value > SCALE_MAX) {
                          alert(`Please enter a value between ${SCALE_MIN} and ${SCALE_MAX}!`);
                          updateSettings({ minScale: 0.5 });
                        }
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="min-max-input">
                    <label>-</label>
                    <input 
                      type="number"
                      className="slider-value-input"
                      value={settings.maxScale}
                      min={SCALE_MIN}
                      max={SCALE_MAX}
                      step="0.1"
                      disabled={!settings.randomScale}
                      onChange={(e) => updateSettings({ maxScale: Number(e.target.value) })}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value < SCALE_MIN || value > SCALE_MAX) {
                          alert(`Please enter a value between ${SCALE_MIN} and ${SCALE_MAX}!`);
                          updateSettings({ maxScale: 1.5 });
                        }
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
              </div>

              <div className="placement-tool full-width">
                <div className="randomize-header">
                  <input 
                    type="checkbox" 
                    id="randomRotation"
                    className="placement-checkbox"
                    checked={settings.randomRotation}
                    onChange={(e) => updateSettings({ randomRotation: e.target.checked })}
                  />
                  <label htmlFor="randomRotation">Randomize Rotation</label>
                </div>
                <div className="min-max-inputs">
                  <div className="min-max-input">
                    <label>Range: </label>
                    <input 
                      type="number"
                      className="slider-value-input"
                      value={settings.minRotation}
                      min={ROTATION_MIN}
                      max={ROTATION_MAX}
                      step="15"
                      disabled={!settings.randomRotation}
                      onChange={(e) => updateSettings({ minRotation: Number(e.target.value) })}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value < ROTATION_MIN || value > ROTATION_MAX) {
                          alert(`Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`);
                          updateSettings({ minRotation: 0 });
                        }
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="min-max-input">
                    <label>-</label>
                    <input 
                      type="number"
                      className="slider-value-input"
                      value={settings.maxRotation}
                      min={ROTATION_MIN}
                      max={ROTATION_MAX}
                      step="15"
                      disabled={!settings.randomRotation}
                      onChange={(e) => updateSettings({ maxRotation: Number(e.target.value) })}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value < ROTATION_MIN || value > ROTATION_MAX) {
                          alert(`Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`);
                          updateSettings({ maxRotation: 360 });
                        }
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </div>
              </div>

              <div className="placement-tool-slider">
                <div className="slider-header">
                  <label htmlFor="placementScale">Object Scale</label>
                  <input 
                    type="number"
                    className="slider-value-input"
                    value={settings.scale}
                    min={SCALE_MIN}
                    max={SCALE_MAX}
                    step="0.1"
                    disabled={settings.randomScale}
                    onChange={(e) => updateSettings({ scale: Number(e.target.value) })}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value < SCALE_MIN || value > SCALE_MAX) {
                        alert(`Please enter a value between ${SCALE_MIN} and ${SCALE_MAX}!`);
                        updateSettings({ scale: 1.0 });
                      }
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                <input 
                  type="range" 
                  id="placementScale"
                  min={SCALE_MIN}
                  max={SCALE_MAX}
                  step="0.1"
                  value={settings.scale}
                  className="placement-slider"
                  onChange={(e) => updateSettings({ scale: Number(e.target.value) })}
                  disabled={settings.randomScale}
                />
              </div>

              <div className="placement-tool-slider">
                <div className="slider-header">
                  <label htmlFor="placementRotation">Rotation</label>
                  <input 
                    type="number"
                    className="slider-value-input"
                    value={settings.rotation}
                    min={ROTATION_MIN}
                    max={ROTATION_MAX}
                    step="15"
                    disabled={settings.randomRotation}
                    onChange={(e) => updateSettings({ rotation: Number(e.target.value) })}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value < ROTATION_MIN || value > ROTATION_MAX) {
                        alert(`Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`);
                        updateSettings({ rotation: 0 });
                      }
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                  <span className="degree-symbol">°</span>
                </div>
                <input 
                  type="range" 
                  id="placementRotation"
                  min={ROTATION_MIN}
                  max={ROTATION_MAX}
                  step="15"
                  value={settings.rotation}
                  className="placement-slider"
                  onChange={(e) => updateSettings({ rotation: Number(e.target.value) })}
                  disabled={settings.randomRotation}
                />
              </div>
            </div>
          </div>
        )}

        <div className="texture-drop-zone"
          onDragOver={(e) => {
            e.preventDefault();
            e.currentTarget.classList.add("drag-over");
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove("drag-over");
          }}
          onDrop={handleDrop}
        >
          <div className="drop-zone-content">
            <div className="drop-zone-icons">
              <FaUpload className="upload-icon" />
              {activeTab === "blocks" ? <FaCube className="block-icon" /> : <FaTree className="block-icon" />}
            </div>
            <div className="drop-zone-text">
              {activeTab === "blocks" 
                ? "Drag textures here to add new blocks"
                : "Drag .gltf models here to add new environment objects"}
            </div>
          </div>
        </div>

        <div className="tab-button-wrapper">
          <button
            className={`tab-button ${activeTab === "blocks" ? "active" : ""}`}
            onClick={() => handleTabChange("blocks")}
          >
            Blocks
          </button>
          <button
            className={`tab-button ${activeTab === "environment" ? "active" : ""}`}
            onClick={() => handleTabChange("environment")}
          >
            Environment
          </button>
        </div>
      </div>
      <div className="dead-space"></div>
    </div>
  );
};

export default BlockToolsSidebar;
