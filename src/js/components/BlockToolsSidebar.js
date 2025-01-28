import React, { useState, useEffect } from "react";
import { FaUpload, FaCube, FaTree } from "react-icons/fa";
import BlockButton from "./BlockButton";
import EnvironmentButton from "./EnvironmentButton";
import "../../css/BlockToolsSidebar.css";

const SIZE_MIN = 0.1;
const SIZE_MAX = 5.0;
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
  const [sizeValue, setSizeValue] = useState("1.0");
  const [rotationValue, setRotationValue] = useState("0");
  const [randomRotation, setRandomRotation] = useState(false);
  const [randomSize, setRandomSize] = useState(false);
  const [minSize, setMinSize] = useState("0.5");
  const [maxSize, setMaxSize] = useState("1.5");
  const [minRotation, setMinRotation] = useState("0");
  const [maxRotation, setMaxRotation] = useState("360");
  const [tempMinSize, setTempMinSize] = useState(minSize);
  const [tempMaxSize, setTempMaxSize] = useState(maxSize);
  const [tempMinRotation, setTempMinRotation] = useState(minRotation);
  const [tempMaxRotation, setTempMaxRotation] = useState(maxRotation);
  const [tempSizeValue, setTempSizeValue] = useState(sizeValue);
  const [tempRotationValue, setTempRotationValue] = useState(rotationValue);

  useEffect(() => {
    console.log('Updating placement settings:', {
      randomSize,
      randomRotation,
      minSize,
      maxSize,
      minRotation,
      maxRotation,
      size: sizeValue,
      rotation: rotationValue,
    });
    
    onPlacementSettingsChange?.({
      randomSize,
      randomRotation,
      minSize: parseFloat(minSize),
      maxSize: parseFloat(maxSize),
      minRotation: parseFloat(minRotation),
      maxRotation: parseFloat(maxRotation),
      size: parseFloat(sizeValue),
      rotation: parseFloat(rotationValue),
    });
  }, [
    randomSize,
    randomRotation,
    minSize,
    maxSize,
    minRotation,
    maxRotation,
    sizeValue,
    rotationValue,
  ]);

  return (
    <div className="block-tools-container">
      <div className="dead-space"></div>
      <div className="block-tools-sidebar">
        <div className="block-buttons-grid">
          {activeTab === "blocks" ? (
            <>
              <div
                style={{
                  width: "100%",
                  borderBottom: "2px solid #ccc",
                  fontSize: "12px",
                  textAlign: "left",
                }}
              >
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
              <div
                style={{
                  width: "100%",
                  borderBottom: "2px solid #ccc",
                  fontSize: "12px",
                  textAlign: "left",
                }}
              >
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
            <>
              <div className="environment-button-wrapper">
                <div
                  style={{
                    width: "100%",
                    borderBottom: "2px solid #ccc",
                    fontSize: "12px",
                    textAlign: "left",
                  }}
                >
                  Default Environment Objects (ID: 200-299)
                </div>
                {environmentModels
                  .filter((envType) => !envType.isCustom)
                  .map((envType) => (
                    <EnvironmentButton
                      key={envType.id}
                      envType={envType}
                      isSelected={envType.id === currentBlockType?.id}
                      onSelect={handleEnvironmentSelect}
                      onDelete={handleDeleteEnvironmentModel}
                    />
                  ))}
                <div
                  style={{
                    width: "100%",
                    borderBottom: "2px solid #ccc",
                    fontSize: "12px",
                    textAlign: "left",
                    marginTop: "10px",
                  }}
                >
                  Custom Environment Objects (ID: 300+)
                </div>
                {environmentModels
                  .filter((envType) => envType.isCustom)
                  .map((envType) => (
                    <EnvironmentButton
                      key={envType.id}
                      envType={envType}
                      isSelected={envType.id === currentBlockType?.id}
                      onSelect={handleEnvironmentSelect}
                      onDelete={handleDeleteEnvironmentModel}
                    />
                  ))}
              </div>
            </>
          )}
        </div>
        {activeTab === "environment" && (
          <div className="placement-tools">
            <div className="placement-tools-grid">
              <div className="placement-tool full-width">
                <div className="randomize-header">
                  <input 
                    type="checkbox" 
                    id="randomSize"
                    className="placement-checkbox"
                    checked={randomSize}
                    onChange={(e) => setRandomSize(e.target.checked)}
                  />
                  <label htmlFor="randomSize">Randomize Scale</label>
                </div>
                <div className="min-max-inputs">
                  <div className="min-max-input">
                    <label>Range: </label>
                    <input 
                      type="number"
                      className="slider-value-input"
                      value={tempMinSize}
                      step="0.1"
                      disabled={!randomSize}
                      onChange={(e) => setTempMinSize(e.target.value)}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value >= SIZE_MIN && value <= SIZE_MAX) {
                          setMinSize(value.toFixed(1));
                          setTempMinSize(value.toFixed(1));
                        } else {
                          alert(`Please enter a value between ${SIZE_MIN} and ${SIZE_MAX}!`);
                          setTempMinSize(minSize);
                        }
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      min={SIZE_MIN}
                      max={SIZE_MAX}
                    />
                  </div>
                  <div className="min-max-input">
                    <label>-</label>
                    <input 
                      type="number"
                      className="slider-value-input"
                      value={tempMaxSize}
                      step="0.1"
                      disabled={!randomSize}
                      onChange={(e) => setTempMaxSize(e.target.value)}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value >= SIZE_MIN && value <= SIZE_MAX) {
                          setMaxSize(value.toFixed(1));
                          setTempMaxSize(value.toFixed(1));
                        } else {
                          alert(`Please enter a value between ${SIZE_MIN} and ${SIZE_MAX}!`);
                          setTempMaxSize(maxSize);
                        }
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      min={SIZE_MIN}
                      max={SIZE_MAX}
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
                    checked={randomRotation}
                    onChange={(e) => setRandomRotation(e.target.checked)}
                  />
                  <label htmlFor="randomRotation">Randomize Rotation</label>
                </div>
                <div className="min-max-inputs">
                  <div className="min-max-input">
                    <div className="slider-value-wrapper">
                      <label>Range: </label>
                      <input 
                        type="number"
                        className="slider-value-input"
                        value={tempMinRotation}
                        min={ROTATION_MIN}
                        max={ROTATION_MAX}
                        step="15"
                        disabled={!randomRotation}
                        onChange={(e) => setTempMinRotation(e.target.value)}
                        onBlur={(e) => {
                          const value = Number(e.target.value);
                          if (value >= ROTATION_MIN && value <= ROTATION_MAX) {
                            setMinRotation(value);
                            setTempMinRotation(value);
                          } else {
                            alert(`Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`);
                            setTempMinRotation(minRotation);
                          }
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                  <div className="min-max-input">
                    <label>-</label>
                    <div className="slider-value-wrapper">
                      <input 
                        type="number"
                        className="slider-value-input"
                        value={tempMaxRotation}
                        min={ROTATION_MIN}
                        max={ROTATION_MAX}
                        step="5"
                        disabled={!randomRotation}
                        onChange={(e) => setTempMaxRotation(e.target.value)}
                        onBlur={(e) => {
                          const value = Number(e.target.value);
                          if (value >= ROTATION_MIN && value <= ROTATION_MAX) {
                            setMaxRotation(value);
                            setTempMaxRotation(value);
                          } else {
                            alert(`Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`);
                            setTempMaxRotation(maxRotation);
                          }
                        }}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="placement-tool-slider">
                <div className="slider-header">
                  <label htmlFor="placementSize">Object Scale</label>
                  <input 
                    type="number"
                    className="slider-value-input"
                    value={tempSizeValue}
                    min={SIZE_MIN}
                    max={SIZE_MAX}
                    step="0.1"
                    disabled={randomSize}
                    onChange={(e) => setTempSizeValue(e.target.value)}
                    onBlur={(e) => {
                      const value = Number(e.target.value);
                      if (value >= SIZE_MIN && value <= SIZE_MAX) {
                        setSizeValue(value.toFixed(1));
                        setTempSizeValue(value.toFixed(1));
                      } else {
                        alert(`Please enter a value between ${SIZE_MIN} and ${SIZE_MAX}!`);
                        setTempSizeValue(sizeValue);
                      }
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                  />
                </div>
                <input 
                  type="range" 
                  id="placementSize"
                  min={SIZE_MIN}
                  max={SIZE_MAX}
                  step="0.1"
                  value={tempSizeValue}
                  className="placement-slider"
                  onChange={(e) => setTempSizeValue(Number(e.target.value).toFixed(1))}
                  disabled={randomSize}
                />
              </div>
              <div className="placement-tool-slider">
                <div className="slider-header">
                  <label htmlFor="placementRotation">Rotation</label>
                  <input 
                      type="number"
                      className="slider-value-input"
                      value={tempRotationValue}
                      min={ROTATION_MIN}
                      max={ROTATION_MAX}
                      step="15"
                      disabled={randomRotation}
                      onChange={(e) => setTempRotationValue(e.target.value)}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (value >= ROTATION_MIN && value <= ROTATION_MAX) {
                          setRotationValue(value);
                          setTempRotationValue(value);
                        } else {
                          alert(`Please enter a value between ${ROTATION_MIN} and ${ROTATION_MAX}!`);
                          setTempRotationValue(rotationValue);
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
                  value={tempRotationValue}
                  className="placement-slider"
                  onChange={(e) => setTempRotationValue(e.target.value)}
                  disabled={randomRotation}
                />
              </div>
            </div>
          </div>
        )}
        <div
          className="texture-drop-zone"
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
              {activeTab === "blocks" ? (
                <FaCube className="block-icon" />
              ) : (
                <FaTree className="block-icon" />
              )}
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
            className={`tab-button ${
              activeTab === "environment" ? "active" : ""
            }`}
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
