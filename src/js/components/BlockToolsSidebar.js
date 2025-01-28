import React, { useState } from "react";
import { FaUpload, FaCube, FaTree } from "react-icons/fa";
import BlockButton from "./BlockButton";
import EnvironmentButton from "./EnvironmentButton";
import "../../css/BlockToolsSidebar.css";

const SCALE_MIN = 0.1;
const SCALE_MAX = 5.0;
const ROTATION_MIN = 0;
const ROTATION_MAX = 360;

const BlockToolsSidebar = ({
  activeTab,
  blockTypes,
  currentBlockType,
  customBlocks,
  handleTabChange,
  setCurrentBlockType,
  handleDeleteCustomBlock,
  handleDragStart,
  handleEnvironmentSelect,
  handleDeleteEnvironmentModel,
  environmentModels,
  handleDrop,
  onPlacementSettingsChange,
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
    onPlacementSettingsChange?.(newSettings);
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
                  isSelected={blockType.id === currentBlockType?.id}
                  onSelect={(block) => {
                    setCurrentBlockType(block);
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
                  isSelected={blockType.id === currentBlockType?.id}
                  onSelect={(block) => {
                    setCurrentBlockType(block);
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
                  isSelected={envType.id === currentBlockType?.id}
                  onSelect={handleEnvironmentSelect}
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
                  isSelected={envType.id === currentBlockType?.id}
                  onSelect={handleEnvironmentSelect}
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
