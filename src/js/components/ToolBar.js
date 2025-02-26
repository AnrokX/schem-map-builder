import React, { useState, useEffect } from "react";
import { FaPlus, FaMinus, FaCube, FaBorderStyle, FaLock, FaLockOpen, FaUndo, FaRedo, FaExpand, FaTrash, FaCircle, FaSquare, FaMountain } from "react-icons/fa";
import Tooltip from "../components/Tooltip";
import { DatabaseManager, STORES } from "../DatabaseManager";
import "../../css/ToolBar.css";
import JSZip from "jszip";
import { environmentModels } from "../EnvironmentBuilder";
import { getBlockTypes } from "../TerrainBuilder";
import * as THREE from "three";
import { version } from "../Constants";

const ToolBar = ({ terrainBuilderRef, mode, handleModeChange, axisLockEnabled, setAxisLockEnabled, placementSize, setPlacementSize, handleImport, handleAssetPackImport, setGridSize, undoRedoManager, currentBlockType }) => {
	const [newGridSize, setNewGridSize] = useState(100);
	const [showDimensionsModal, setShowDimensionsModal] = useState(false);
	const [dimensions, setDimensions] = useState({
		width: 1,
		length: 1,
		height: 1,
	});
	const [showGridSizeModal, setShowGridSizeModal] = useState(false);
	const [showBorderModal, setShowBorderModal] = useState(false);
	const [borderDimensions, setBorderDimensions] = useState({
		width: 1,
		length: 1,
		height: 1,
	});
	const [showTerrainModal, setShowTerrainModal] = useState(false);
	const [terrainSettings, setTerrainSettings] = useState({
		width: 32,
		length: 32,
		height: 16,
		scale: 1,
		roughness: 85,
		clearMap: false,
	});

	// Add state for undo/redo button availability
	const [canUndo, setCanUndo] = useState(true);
	const [canRedo, setCanRedo] = useState(false);
	let startPos = {
		x: 0,
		y: 0,
		z: 0,
	};

	const handleGenerateBlocks = () => {
		const { width, length, height } = dimensions;
		
		// Validate dimensions
		if (width <= 0 || length <= 0 || height <= 0) {
			alert("Dimensions must be greater than 0");
			return;
		}

		console.log("Generating blocks with dimensions:", { width, length, height });
		console.log("Current block type:", currentBlockType);

		// Get current terrain data directly from TerrainBuilder
		const terrainData = terrainBuilderRef.current.getCurrentTerrainData();
		
		console.log("Initial terrain data count:", Object.keys(terrainData).length);

		// Count how many blocks we're adding
		let blocksAdded = 0;
		startPos = {
			x: -width / 2,
			y: 0,
			z: -length / 2,
		};

		for (let x = 0; x < width; x++) {
			for (let y = 0; y < height; y++) {
				for (let z = 0; z < length; z++) {
					const position = {
						x: startPos.x + x,
						y: startPos.y + y,
						z: startPos.z + z,
					};

					// Add block to terrain data
					const key = `${position.x},${position.y},${position.z}`;
					terrainData[key] = { ...currentBlockType };
					blocksAdded++;
				}
			}
		}

		console.log(`Added ${blocksAdded} blocks to terrain data`);
		console.log("Final terrain data count:", Object.keys(terrainData).length);
		
		// Update terrain directly in TerrainBuilder
		console.log("Calling updateTerrainFromToolBar");
		if (terrainBuilderRef.current) {
			terrainBuilderRef.current.updateTerrainFromToolBar(terrainData);
			console.log("updateTerrainFromToolBar called successfully");
		} else {
			console.error("terrainBuilderRef.current is null or undefined");
		}
		
		setShowDimensionsModal(false);
	};

	const handleGenerateBorder = () => {
		const { width, length, height } = borderDimensions;

		// Validate dimensions
		if (width <= 0 || length <= 0 || height <= 0) {
			alert("Border dimensions must be greater than 0");
			return;
		}

		startPos = {
			x: -width / 2,
			y: 0,
			z: -length / 2,
		};

		// Get current terrain data directly from TerrainBuilder
		const terrainData = terrainBuilderRef.current.getCurrentTerrainData();

		// Generate the border blocks
		for (let x = 0; x < width; x++) {
			for (let y = 0; y < height; y++) {
				for (let z = 0; z < length; z++) {
					// Only add blocks that form the outer shell
					if (x === 0 || x === width - 1 || z === 0 || z === length - 1) {
						// Add blocks for all Y positions on outer edges
						const position = {
							x: startPos.x + x,
							y: startPos.y + y,
							z: startPos.z + z,
						};
						const key = `${position.x},${position.y},${position.z}`;
						terrainData[key] = { ...currentBlockType };
					}
				}
			}
		}
		
		// Update terrain directly in TerrainBuilder
		if (terrainBuilderRef.current) {
			terrainBuilderRef.current.updateTerrainFromToolBar(terrainData);
		}
		
		setShowBorderModal(false);
	};

	const handleClearMap = () => {
		terrainBuilderRef.current?.clearMap();
	};

	const generateTerrain = () => {
		console.log("Generating terrain");
		const { width, length, height, scale, roughness, clearMap } = terrainSettings;

		// Validate settings
		if (width <= 0 || length <= 0 || height <= 0 || scale <= 0) {
			alert("All dimensions and scale must be greater than 0");
			return;
		}

		// Clear existing terrain if requested
		if (clearMap) {
			terrainBuilderRef.current?.clearMap();
		}

		// Generate noise map with proper scale and amplitude
		const noiseMap = generateNoise(width, length, {
			amplitude: height, // Keep amplitude at 1 for normalized values
			scale: scale / 100, // Scale affects frequency of features
			octaves: 4, // Number of noise layers
			persistence: roughness / 100, // How much each octave contributes
		});

		// Get current terrain data or start with empty object if clearing
		const terrainData = clearMap ? {} : terrainBuilderRef.current.getCurrentTerrainData();
				
		const startPos = {
			x: -Math.floor(width / 2),
			y: 0,
			z: -Math.floor(length / 2)
		};

		// Generate terrain blocks based on noise map
		for (let x = 0; x < width; x++) {
			for (let z = 0; z < length; z++) {
				// Scale noise value (0 to 1) to desired height range
				const terrainHeight = Math.floor(noiseMap[x][z] * height);

				// Fill from bottom up to terrain height
				for (let y = 0; y <= terrainHeight; y++) {
					const position = {
						x: startPos.x + x,
						y: startPos.y + y,
						z: startPos.z + z
					};

					// Add block to terrain data
					const key = `${position.x},${position.y},${position.z}`;
					terrainData[key] = { ...currentBlockType };
				}
			}
		}
		
		// Update terrain directly in TerrainBuilder
		if (terrainBuilderRef.current) {
			terrainBuilderRef.current.updateTerrainFromToolBar(terrainData);
		}
		
		setShowTerrainModal(false);
	};

	const scanDirectory = async () => {
		const context = require.context("../../../public/assets", true, /\.(png|jpe?g|glb|gltf|json|wav|mp3|ogg|pem|key|crt)$/);
		return context.keys().map((key) => key.replace("./", ""));
	};

	const handleExport = () => {
		try {
			if (!terrainBuilderRef.current.getCurrentTerrainData() || Object.keys(terrainBuilderRef.current.getCurrentTerrainData()).length === 0) {
				alert("No map found to export!");
				return;
			}

			const zip = new JSZip();
			const assetsFolder = zip.folder("assets");
			const blocksFolder = assetsFolder.folder("blocks");
			const mapsFolder = assetsFolder.folder("maps");
			const modelsFolder = assetsFolder.folder("models/environment");
			const certsFolder = assetsFolder.folder("certs");
			const soundsFolder = assetsFolder.folder("sounds");
			const skyboxesFolder = assetsFolder.folder("skyboxes");

			// Add custom GLTF models from IndexedDB
			DatabaseManager.getData(STORES.CUSTOM_MODELS, "models")
				.then((customModels) => {
					customModels = customModels || [];
					console.log("Custom models to export:", customModels);

					for (const model of customModels) {
						if (!model.data) {
							console.warn(`No data found for model ${model.name}`);
							continue;
						}

						const blob = new Blob([model.data], { type: "model/gltf+json" });
						console.log(`Adding model to zip: ${model.name}.gltf`);
						modelsFolder.file(`${model.name}.gltf`, blob);
					}

					return DatabaseManager.getData(STORES.ENVIRONMENT, "current");
				})
				.then((environmentObjects) => {
					environmentObjects = environmentObjects || [];

					const simplifiedTerrain = Object.entries(terrainBuilderRef.current.getCurrentTerrainData()).reduce((acc, [key, value]) => {
						if (key.split(",").length === 3) {
							acc[key] = value.id;
						}
						return acc;
					}, {});

					const allBlockTypes = getBlockTypes();

					const exportData = {
						blockTypes: Array.from(
							new Map(
								allBlockTypes.map((block) => [
									block.id,
									{
										id: block.id,
										name: block.name,
										textureUri: block.isMultiTexture ? `blocks/${block.name}` : `blocks/${block.name}.png`,
										isCustom: block.isCustom || false,
									},
								])
							).values()
						),
						blocks: simplifiedTerrain,
						entities: environmentObjects.reduce((acc, obj) => {
							const entityType = environmentModels.find((model) => model.modelUrl === obj.modelUrl);

							if (entityType) {
								const quaternion = new THREE.Quaternion();
								quaternion.setFromEuler(new THREE.Euler(obj.rotation.x, obj.rotation.y, obj.rotation.z));

								const modelUri = entityType.isCustom ? `models/environment/${entityType.name}.gltf` : obj.modelUrl.replace("assets/", "");

								// Calculate adjusted Y position
								const boundingBoxHeight = entityType.boundingBoxHeight || 1;
								const verticalOffset = (boundingBoxHeight * obj.scale.y) / 2;
								const adjustedY = obj.position.y + 0.5 + verticalOffset;

								// Use adjusted Y in the key
								const key = `${obj.position.x},${adjustedY},${obj.position.z}`;

								acc[key] = {
									modelUri: modelUri,
									modelLoopedAnimations: entityType.animations || ["idle"],
									modelScale: obj.scale.x,
									name: entityType.name,
									rigidBodyOptions: {
										type: "kinematic_velocity",
										rotation: {
											x: quaternion.x,
											y: quaternion.y,
											z: quaternion.z,
											w: quaternion.w,
										},
									},
								};
							}
							return acc;
						}, {}),
					};

					mapsFolder.file("terrain.json", JSON.stringify(exportData, null, 2));
					return DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks");
				})
				.then((customBlocks) => {
					customBlocks = customBlocks || [];

					// Add custom block textures
					for (const block of customBlocks) {
						const base64Data = block.textureUri.split(",")[1];
						const binaryData = atob(base64Data);
						const array = new Uint8Array(binaryData.length);
						for (let i = 0; i < binaryData.length; i++) {
							array[i] = binaryData.charCodeAt(i);
						}
						const blob = new Blob([array], { type: "image/png" });
						blocksFolder.file(`${block.name}.png`, blob);
					}

					// Add default assets and generate zip
					const files = scanDirectory();
					const promises = [];
					for (const filePath of files) {
						const task = new Promise(async (resolve) => {
							try {
								const response = await fetch(`/assets/${filePath}`);
								if (!response.ok) {
									console.warn(`Failed to fetch file ${filePath}`);
									return;
								}

								const blob = await response.blob();

								// Special handling for different asset types
								if (filePath.includes("certs/")) {
									// Just store the cert file directly in the certs folder
									const certFileName = filePath.split("/").pop();
									certsFolder.file(certFileName, blob);
								} else if (filePath.startsWith("sounds/")) {
									soundsFolder.file(filePath.replace("sounds/", ""), blob);
								} else if (filePath.startsWith("skyboxes/")) {
									skyboxesFolder.file(filePath.replace("skyboxes/", ""), blob);
								} else {
									assetsFolder.file(filePath, blob);
								}
							} catch (error) {
								console.warn(`Failed to add file ${filePath}:`, error);
								return;
							} finally {
								resolve();
							}
						});
						promises.push(task);
					}

					return Promise.all(promises);
				})
				.then(() => {
					console.log("Folders in zip:", Object.keys(zip.files));
					return zip.generateAsync({ type: "blob" });
				})
				.then((content) => {
					const url = URL.createObjectURL(content);
					const a = document.createElement("a");
					a.href = url;
					a.download = "hytopia_build_" + version + "_assets.zip";
					a.click();
					URL.revokeObjectURL(url);
				})
				.catch((error) => {
					console.error("Error exporting map:", error);
					alert("Error exporting map. Please try again.");
				});
		} catch (error) {
			console.error("Error exporting map:", error);
			alert("Error exporting map. Please try again.");
		}
	};

	const handleExportMap = () => {
		try {
			if (!terrainBuilderRef.current.getCurrentTerrainData() || Object.keys(terrainBuilderRef.current.getCurrentTerrainData()).length === 0) {
				alert("No map found to export!");
				return;
			}

			DatabaseManager.getData(STORES.ENVIRONMENT, "current")
				.then((environmentObjects) => {
					environmentObjects = environmentObjects || [];

					const simplifiedTerrain = Object.entries(terrainBuilderRef.current.getCurrentTerrainData()).reduce((acc, [key, value]) => {
						if (key.split(",").length === 3) {
							acc[key] = value.id;
						}
						return acc;
					}, {});

					const allBlockTypes = getBlockTypes();

					const exportData = {
						blockTypes: Array.from(
							new Map(
								allBlockTypes.map((block) => [
									block.id,
									{
										id: block.id,
										name: block.name,
										textureUri: block.isMultiTexture ? `blocks/${block.name}` : `blocks/${block.name}.png`,
										isCustom: block.isCustom || false,
									},
								])
							).values()
						),
						blocks: simplifiedTerrain,
						entities: environmentObjects.reduce((acc, obj) => {
							const entityType = environmentModels.find((model) => model.modelUrl === obj.modelUrl);

							if (entityType) {
								const quaternion = new THREE.Quaternion();
								quaternion.setFromEuler(new THREE.Euler(obj.rotation.x, obj.rotation.y, obj.rotation.z));

								const modelUri = entityType.isCustom ? `models/environment/${entityType.name}.gltf` : obj.modelUrl.replace("assets/", "");

								// Calculate adjusted Y position
								const boundingBoxHeight = entityType.boundingBoxHeight || 1;
								const verticalOffset = (boundingBoxHeight * obj.scale.y) / 2;
								const adjustedY = obj.position.y + 0.5 + verticalOffset;

								// Use adjusted Y in the key
								const key = `${obj.position.x},${adjustedY},${obj.position.z}`;

								acc[key] = {
									modelUri: modelUri,
									modelLoopedAnimations: entityType.animations || ["idle"],
									modelScale: obj.scale.x,
									name: entityType.name,
									rigidBodyOptions: {
										type: "kinematic_velocity",
										rotation: {
											x: quaternion.x,
											y: quaternion.y,
											z: quaternion.z,
											w: quaternion.w,
										},
									},
								};
							}
							return acc;
						}, {}),
					};

					const jsonContent = JSON.stringify(exportData, null, 2);
					const blob = new Blob([jsonContent], { type: "application/json" });
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url;
					a.download = "terrain.json";
					a.click();
					URL.revokeObjectURL(url);
				})
				.catch((error) => {
					console.error("Error exporting map:", error);
					alert("Error exporting map. Please try again.");
				});
		} catch (error) {
			console.error("Error exporting map:", error);
			alert("Error exporting map. Please try again.");
		}
	};

	// Replace the import with this simple implementation
	const generateNoise = (width, length, options = {}) => {
		const { amplitude = 1, scale = 0.1, octaves = 4, persistence = 0.5 } = options;
		const result = Array(width).fill().map(() => Array(length).fill(0));
		
		// Simple random noise function
		const noise = (x, y) => {
		const n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
		return n - Math.floor(n);
		};
		
		// Generate basic noise
		for (let x = 0; x < width; x++) {
		for (let z = 0; z < length; z++) {
			let value = 0;
			let frequency = scale;
			let amp = 1;
			
			// Add octaves
			for (let o = 0; o < octaves; o++) {
			const sampleX = x * frequency;
			const sampleZ = z * frequency;
			value += noise(sampleX, sampleZ) * amp;
			
			amp *= persistence;
			frequency *= 2;
			}
			
			// Normalize to 0-1 range and apply amplitude
			result[x][z] = (value / octaves) * amplitude;
		}
		}
		
		return result;
	};
  

	const applyNewGridSize = async (newGridSize) => {
		if (newGridSize > 10) {
			setGridSize(newGridSize);

			// save grid size to local storage
			// this has to be done here, because terrainbuilder
			// gets the grid size from local storage
			localStorage.setItem("gridSize", newGridSize);

			setShowGridSizeModal(false);
		} else {
			alert("Grid size must be greater than 10");
		}
	};

	// Add effect to check undo/redo availability
	useEffect(() => {
		const checkUndoRedoAvailability = async () => {
			const undoStates = await DatabaseManager.getData(STORES.UNDO, 'states') || [];
			const redoStates = await DatabaseManager.getData(STORES.REDO, 'states') || [];
			setCanUndo(undoStates.length > 0);
			setCanRedo(redoStates.length > 0);
		};
		
		checkUndoRedoAvailability();
		// Set up an interval to check periodically
		const interval = setInterval(checkUndoRedoAvailability, 1000);
		return () => clearInterval(interval);
	}, []);

	return (
		<>
			<div className="controls-container">
				<div className="control-group">
					<div className="control-button-wrapper">
						<Tooltip text="Import just the map file">
							<button
								onClick={() => document.getElementById("mapFileInput").click()}
								className="control-button import-export-button">
								Map
							</button>
							<input
								id="mapFileInput"
								type="file"
								accept=".json"
								onChange={handleImport}
								style={{ display: "none" }}
							/>
						</Tooltip>
						<Tooltip text="Import complete asset pack (includes map and textures)">
							<button
								onClick={() => document.getElementById("assetPackInput").click()}
								className="control-button import-export-button">
								Asset Pack
							</button>
							<input
								id="assetPackInput"
								type="file"
								accept=".zip"
								onChange={handleAssetPackImport}
								style={{ display: "none" }}
							/>
						</Tooltip>
					</div>
					<div className="control-label">Import</div>
				</div>

				<div className="control-group">
					<div className="control-button-wrapper">
						<Tooltip text="Export map and assets as a complete package">
							<button
								onClick={() => handleExport()}
								className="control-button import-export-button">
								Asset Pack
							</button>
						</Tooltip>
						<Tooltip text="Export just the map file">
							<button
								onClick={() => handleExportMap()}
								className="control-button import-export-button">
								Map
							</button>
						</Tooltip>
					</div>
					<div className="control-label">Export</div>
				</div>

				<div className="control-group">
					<div className="control-button-wrapper">
						<Tooltip text="Add blocks">
							<button
								onClick={() => handleModeChange("add")}
								className={`control-button ${mode === "add" ? "selected" : ""}`}>
								<FaPlus />
							</button>
						</Tooltip>
						<Tooltip text="Remove blocks">
							<button
								onClick={() => handleModeChange("remove")}
								className={`control-button ${mode === "remove" ? "selected" : ""}`}>
								<FaMinus />
							</button>
						</Tooltip>
						<Tooltip text={axisLockEnabled ? "Disable axis lock" : "Enable axis lock (Not currently working)"}>
							<button
								onClick={() => setAxisLockEnabled(!axisLockEnabled)}
								className={`control-button ${axisLockEnabled ? "selected" : ""}`}>
								{axisLockEnabled ? <FaLock /> : <FaLockOpen />}
							</button>
						</Tooltip>
						<Tooltip text="Undo (Ctrl+Z)">
							<button
								onClick={() => undoRedoManager.handleUndo()}
								className={`control-button ${!canUndo ? 'disabled' : ''}`}
								disabled={!canUndo}>
								<FaUndo />
							</button>
						</Tooltip>
						<Tooltip text="Redo (Ctrl+Y)">
							<button
								onClick={() => undoRedoManager.handleRedo()}
								className={`control-button ${!canRedo ? 'disabled' : ''}`}
								disabled={!canRedo}>
								<FaRedo />
							</button>
						</Tooltip>
						<div className="control-divider-vertical"></div>
						<Tooltip text="Single block placement">
							<button
								onClick={() => setPlacementSize("single")}
								className={`control-button ${placementSize === "single" ? "selected" : ""}`}>
								<FaCircle style={{ width: "5px", height: "5px" }} />
							</button>
						</Tooltip>
						<div className="control-divider-vertical"></div>
						<Tooltip text="Cross pattern (5 blocks)">
							<button
								onClick={() => setPlacementSize("cross")}
								className={`control-button ${placementSize === "cross" ? "selected" : ""}`}>
								<FaCircle style={{ width: "10px", height: "10px" }} />
							</button>
						</Tooltip>
						<Tooltip text="diamond pattern (13 blocks)">
							<button
								onClick={() => setPlacementSize("diamond")}
								className={`control-button ${placementSize === "diamond" ? "selected" : ""}`}>
								<FaCircle style={{ width: "20px", height: "20px" }} />
							</button>
						</Tooltip>
						<div className="control-divider-vertical"></div>
						<Tooltip text="Single block placement">
							<button
								onClick={() => setPlacementSize("square9")}
								className={`control-button ${placementSize === "square9" ? "selected" : ""}`}>
								<FaSquare style={{ width: "10px", height: "10px" }} />
							</button>
						</Tooltip>
						<Tooltip text="Cross pattern (5 blocks)">
							<button
								onClick={() => setPlacementSize("square16")}
								className={`control-button ${placementSize === "square16" ? "selected" : ""}`}>
								<FaSquare style={{ width: "20px", height: "20px" }} />
							</button>
						</Tooltip>
					</div>
					<div className="control-label">Placement Tools</div>
				</div>

				<div className="control-group">
					<div className="control-button-wrapper">
						<Tooltip text="Generate solid cube">
							<button
								onClick={() => setShowDimensionsModal(true)}
								className="control-button">
								<FaCube />
							</button>
						</Tooltip>
						<Tooltip text="Generate wall of Blocks">
							<button
								onClick={() => setShowBorderModal(true)}
								className="control-button">
								<FaBorderStyle />
							</button>
						</Tooltip>
						<Tooltip text="Generate terrain">
							<button
								onClick={() => setShowTerrainModal(true)}
								className="control-button">
								<FaMountain />
							</button>
						</Tooltip>
					</div>
					<div className="control-label">Shape Tools</div>
				</div>

				<div className="control-group">
					<div className="control-button-wrapper">
						<Tooltip text="Change grid size">
							<button
								onClick={() => setShowGridSizeModal(true)}
								className="control-button">
								<FaExpand />
							</button>
						</Tooltip>
						<Tooltip text="Clear entire map">
							<button
								onClick={handleClearMap}
								className="control-button">
								<FaTrash />
							</button>
						</Tooltip>
					</div>
					<div className="control-label">Map Tools</div>
				</div>
			</div>

			{showDimensionsModal && (
				<div className="modal-overlay">
					<div className="modal-content">
						<h3 className="modal-title">Generate Area of Blocks</h3>
						<p className="modal-description">Generate a large area of blocks. Enter the dimensions to define the size of the shape. The currently selected block will be used.</p>
						<div className="modal-input">
							<label>Width: </label>
							<input
								type="number"
								value={dimensions.width}
								onChange={(e) =>
									setDimensions({
										...dimensions,
										width: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Length: </label>
							<input
								type="number"
								value={dimensions.length}
								onChange={(e) =>
									setDimensions({
										...dimensions,
										length: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Height: </label>
							<input
								type="number"
								value={dimensions.height}
								onChange={(e) =>
									setDimensions({
										...dimensions,
										height: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-buttons">
							<button
								className="menu-button"
								onClick={() => {
									handleGenerateBlocks();
								}}>
								Generate
							</button>
							<button
								className="menu-button"
								onClick={() => setShowDimensionsModal(false)}>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{showGridSizeModal && (
				<div className="modal-overlay">
					<div className="modal-content">
						<h3 className="modal-title">Change Grid Size</h3>
						<p className="modal-description">Adjust the size of the building grid. This affects the visible grid and the area where you can place blocks.</p>
						<div className="modal-input">
							<label>New Grid Size (10-500): </label>
							<input
								type="number"
								value={newGridSize}
								onChange={(e) => setNewGridSize(e.target.value)}
								min="10"
								max="500"
							/>
						</div>
						<div className="modal-buttons">
							<button
								className="menu-button"
								onClick={() => applyNewGridSize(newGridSize)}>
								Apply
							</button>
							<button
								className="menu-button"
								onClick={() => setShowGridSizeModal(false)}>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{showBorderModal && (
				<div className="modal-overlay">
					<div className="modal-content">
						<h3 className="modal-title">Generate Wall Blocks (Boarder)</h3>
						<p className="modal-description">Generate a boarder of blocks. Enter the dimensions to define the size of the shape. The currently selected block will be used.</p>
						<div className="modal-input">
							<label>Width: </label>
							<input
								type="number"
								value={borderDimensions.width}
								onChange={(e) =>
									setBorderDimensions({
										...borderDimensions,
										width: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Length: </label>
							<input
								type="number"
								value={borderDimensions.length}
								onChange={(e) =>
									setBorderDimensions({
										...borderDimensions,
										length: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Height: </label>
							<input
								type="number"
								value={borderDimensions.height}
								onChange={(e) =>
									setBorderDimensions({
										...borderDimensions,
										height: parseInt(e.target.value),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-buttons">
							<button
								className="menu-button"
								onClick={() => {
									handleGenerateBorder();
								}}>
								Generate
							</button>
							<button
								className="menu-button"
								onClick={() => setShowBorderModal(false)}>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{showTerrainModal && (
				<div className="modal-overlay">
					<div className="modal-content">
						<h3 className="modal-title">Generate Terrain</h3>
						<p className="modal-description">Generate natural-looking terrain with mountains and valleys. Adjust the slider from roughest terrain (left) to smoothest terrain (right).</p>
						<div className="modal-input">
							<label>Width: </label>
							<input
								type="number"
								value={terrainSettings.width}
								onChange={(e) =>
									setTerrainSettings({
										...terrainSettings,
										width: Math.max(1, parseInt(e.target.value)),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Length: </label>
							<input
								type="number"
								value={terrainSettings.length}
								onChange={(e) =>
									setTerrainSettings({
										...terrainSettings,
										length: Math.max(1, parseInt(e.target.value)),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label>Max Height: </label>
							<input
								type="number"
								value={terrainSettings.height}
								onChange={(e) =>
									setTerrainSettings({
										...terrainSettings,
										height: Math.max(1, parseInt(e.target.value)),
									})
								}
								min="1"
							/>
						</div>
						<div className="modal-input">
							<label style={{ marginBottom: "5px" }}>Terrain Style: </label>
							<div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
								<span>Roughest</span>
								<input
									type="range"
									value={terrainSettings.roughness}
									onChange={(e) =>
										setTerrainSettings({
											...terrainSettings,
											roughness: parseInt(e.target.value),
										})
									}
									min="70"
									max="100"
								/>
								<span>Smoothest</span>
							</div>
						</div>
						<div className="checkbox-input-wrapper">
							<label>Clear existing map:</label>
							<input
								type="checkbox"
								checked={terrainSettings.clearMap}
								onChange={(e) =>
									setTerrainSettings({
										...terrainSettings,
										clearMap: e.target.checked,
									})
								}
							/>
						</div>
						<div className="modal-buttons">
							<button
								className="menu-button"
								onClick={generateTerrain}>
								Generate
							</button>
							<button
								className="menu-button"
								onClick={() => setShowTerrainModal(false)}>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}
		</>
	);
};

export default ToolBar;
