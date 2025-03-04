import React, { useRef, useEffect, useState, forwardRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { playPlaceSound } from "./Sound";
import { cameraManager } from "./Camera";
import { DatabaseManager, STORES } from "./DatabaseManager";
import { THRESHOLD_FOR_PLACING, BLOCK_INSTANCED_MESH_CAPACITY } from "./Constants";
import { refreshBlockTools } from "./components/BlockToolsSidebar";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";

let meshesNeedsRefresh = false;

// Modify the blockTypes definition to be a function that can be updated
let blockTypesArray = (() => {
	const textureContext = require.context("../../public/assets/blocks", true, /\.(png|jpe?g)$/);
	const texturePaths = textureContext.keys();
	const blockMap = new Map();
	let idCounter = 1;

	texturePaths.forEach((path) => {
		// Skip environment and error textures
		if (path.includes("environment") || path.includes("error")) {
			return;
		}

		const match = path.match(/^\.\/(.+?)(\/[+-][xyz])?\.png$/);
		if (match) {
			const [, fullName, side] = match;
			const parts = fullName.split("/");
			const blockName = parts.length > 1 ? parts[0] : fullName.replace(/\.[^/.]+$/, "");

			if (!blockMap.has(blockName)) {
				blockMap.set(blockName, {
					id: idCounter++,
					name: blockName,
					textureUri: `./assets/blocks/${blockName}.png`,
					sideTextures: {},
				});
			}

			if (side) {
				const sideKey = side.slice(1);
				blockMap.get(blockName).sideTextures[sideKey] = `./assets/blocks/${blockName}${side}.png`;
			}
		}
	});

	return Array.from(blockMap.values()).map((block) => ({
		...block,
		isMultiTexture: Object.keys(block.sideTextures).length > 0,
		isEnvironment: false,
		hasMissingTexture: block.textureUri === "./assets/blocks/error.png",
	}));
})();

// Add function to update blockTypes with custom blocks
export const addCustomBlocks = (customBlocks) => {
	if (!customBlocks.length) {
		console.warn('No valid custom blocks provided');
		return;
	}

	const currentCustomBlocks = getCustomBlocks();
	let newCustomBlocks = [...currentCustomBlocks];
	let nextCustomId = currentCustomBlocks.length + 100;

	const checkTextureExists = (textureUri) => {
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => resolve(true);
			img.onerror = () => resolve(false);
			img.src = textureUri;
		});
	};

	// Convert to async function to handle texture checks
	const processBlocks = async () => {
		for (const inputBlock of customBlocks) {
			// Skip blocks with IDs < 100
			if (inputBlock.id && inputBlock.id < 100) {
				console.warn(`Skipping block with ID ${inputBlock.id} - cannot add blocks with IDs < 100`);
				continue;
			}

			// Check if block with same name exists
			const existingBlockIndex = newCustomBlocks.findIndex(b => b.name === inputBlock.name);
			const existingDefaultBlock = blockTypesArray.find(b => b.name === inputBlock.name && b.id < 100);

			// Skip if matching name exists in default blocks
			if (existingDefaultBlock) {
				console.warn(`Skipping block "${inputBlock.name}" - a default block with this name already exists`);
				continue;
			}

			// Check if texture exists
			const textureExists = await checkTextureExists(inputBlock.textureUri);
			const finalTextureUri = textureExists ? inputBlock.textureUri : './assets/blocks/error.png';

			if (!textureExists) {
				console.warn(`Texture not found for block "${inputBlock.name}", using error texture`);
			}

			if (existingBlockIndex !== -1) {
				// Update existing custom block
				newCustomBlocks[existingBlockIndex] = {
					...newCustomBlocks[existingBlockIndex],
					textureUri: finalTextureUri,
					hasMissingTexture: !textureExists
				};
			} else {
				// Add new block
				newCustomBlocks.push({
					id: nextCustomId++,
					name: inputBlock.name,
					textureUri: finalTextureUri,
					isCustom: true,
					isEnvironment: false,
					isMultiTexture: false,
					hasMissingTexture: !textureExists,
					sideTextures: {}
				});
			}
		}

		// Update blockTypesArray with new custom blocks
		blockTypesArray = [
			...blockTypesArray.filter(b => b.id < 100), // Keep default blocks
			...newCustomBlocks // Add/update custom blocks
		];

		// Save to database
		await DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', newCustomBlocks)
			.catch(error => console.error("Error saving custom blocks:", error));

		refreshBlockTools();
		meshesNeedsRefresh = true;
	};

	// Execute the async function
	processBlocks().catch(error => console.error("Error processing custom blocks:", error));
};

export const updateCustomBlock = (block) => {
	// Find existing block with matching name
	const existingBlock = blockTypesArray.find(b => b.name === block.name);

	if (existingBlock) {
		// Update existing block's properties
		existingBlock.textureUri = block.textureUri;
		existingBlock.hasMissingTexture = false;
		existingBlock.isCustom = true;
		existingBlock.isEnvironment = false;
		existingBlock.isMultiTexture = false;

		// Get only the custom blocks (ID >= 100)
		const customBlocks = getCustomBlocks();

		// Save only custom blocks to database
		DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', customBlocks)
			.catch(error => console.error("Error saving custom blocks:", error));

		refreshBlockTools();
		meshesNeedsRefresh = true;
	} else {
		console.warn(`Block with name ${block.name} not found in blockTypesArray`);
	}
};

// Add function to remove custom blocks
export const removeCustomBlocks = (blockIdsToRemove) => {
	// Convert input to array if it's not already
	const idsToRemove = Array.isArray(blockIdsToRemove) ? blockIdsToRemove : [blockIdsToRemove];
	
	// Validate that all IDs are in the custom block range (100-199)
	const invalidIds = idsToRemove.filter(id => id < 100 || id >= 200);
	if (invalidIds.length > 0) {
		console.error('Cannot remove non-custom blocks with IDs:', invalidIds);
		return;
	}

	// Remove the specified blocks
	blockTypesArray = blockTypesArray.filter(block => !idsToRemove.includes(block.id));

	// Save the updated blockTypesArray to the database
	DatabaseManager.saveData(STORES.CUSTOM_BLOCKS, 'blocks', blockTypesArray)
		.catch(error => console.error("Error saving updated blocks:", error));

	console.log("Removed custom blocks with IDs:", idsToRemove);
	refreshBlockTools();
	meshesNeedsRefresh = true;
};

// Export the blockTypes getter
export const getBlockTypes = () => blockTypesArray;

export const getCustomBlocks = () => {
	const customBlocks = blockTypesArray.filter(block => block.id >= 100);
	console.log("custom blocks:", customBlocks);
	return customBlocks;
};

// Export the initial blockTypes for backward compatibility
export const blockTypes = blockTypesArray;

function TerrainBuilder({ onSceneReady, previewPositionToAppJS, currentBlockType, undoRedoManager, mode, setDebugInfo, axisLockEnabled, gridSize, cameraReset, cameraAngle, placementSize, setPageIsLoaded, customBlocks, environmentBuilderRef}, ref) {

	// Scene setup
	const { camera, scene, raycaster, mouse, gl } = useThree();
	const meshesInitializedRef = useRef(false);
	const placementStartState = useRef(null);
	const instancedMeshRef = useRef({});
	const placementStartPosition = useRef(null);
	const orbitControlsRef = useRef();
	const gridRef = useRef();
	const shadowPlaneRef = useRef();
	const directionalLightRef = useRef();
	const terrainRef = useRef({});

	// Refs needed for real-time updates that functions depend on
	const isPlacingRef = useRef(false);
	const currentPlacingYRef = useRef(0);
	const previewPositionRef = useRef(new THREE.Vector3());
	const lockedAxisRef = useRef(null);
	const blockCountsRef = useRef({});
	const totalBlocksRef = useRef(0);
	const previewMeshRef = useRef(null);
	const axisLockEnabledRef = useRef(axisLockEnabled);
	const currentBlockTypeRef = useRef(currentBlockType);
	const isFirstBlockRef = useRef(true);
	const modeRef = useRef(mode);
	const lastPreviewPositionRef = useRef(new THREE.Vector3());
	const placementSizeRef = useRef(placementSize);

	// state for preview position to force re-render of preview cube when it changes
	const [previewPosition, setPreviewPosition] = useState(new THREE.Vector3());

	// Replace lastPlacedBlockRef with a Set to track all recently placed blocks
	const recentlyPlacedBlocksRef = useRef(new Set());

	/// references for
	const canvasRectRef = useRef(null);
	const normalizedMouseRef = useRef(new THREE.Vector2());
	const tempVectorRef = useRef(new THREE.Vector3());
	const tempVec2Ref = useRef(new THREE.Vector2());
	const tempVec2_2Ref = useRef(new THREE.Vector2());

	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//

	/// define buildUpdateTerrain to update the terrain
	const buildUpdateTerrain = () => {
		if (!scene || !meshesInitializedRef.current) return;

		const blockCountsByType = {};
		const transformMatrix = new THREE.Matrix4();

		// Reset instance counts for all mesh types
		Object.values(instancedMeshRef.current).forEach((instancedMesh) => {
			instancedMesh.count = 0;
		});

		// Process each block in the terrain
		Object.entries(terrainRef.current).forEach(([position, blockId]) => {
			const [x, y, z] = position.split(",").map(Number);
			const blockMesh = instancedMeshRef.current[blockId];

			if (blockMesh) {
				const instanceIndex = blockCountsByType[blockId] || 0;
				transformMatrix.setPosition(x, y, z);
				blockMesh.setMatrixAt(instanceIndex, transformMatrix);
				blockCountsByType[blockId] = instanceIndex + 1;
			}
		});

		// Update instance counts and trigger matrix updates
		Object.entries(blockCountsByType).forEach(([blockId, instanceCount]) => {
			const blockMesh = instancedMeshRef.current[blockId];
			blockMesh.count = instanceCount;
			blockMesh.instanceMatrix.needsUpdate = true;
		});

		blockCountsRef.current = blockCountsByType;
		totalBlocksRef.current = Object.keys(terrainRef.current).length;

		updateDebugInfo();

		// Save terrain to storage
		DatabaseManager.saveData(STORES.TERRAIN, "current", terrainRef.current)
			.catch(error => console.error("Error saving terrain:", error));
	};

	const refreshBlockMeshes = () => {
		if (!meshesInitializedRef.current || !scene) return;

		// Clean up existing meshes
		Object.entries(instancedMeshRef.current).forEach(([id, mesh]) => {
			scene.remove(mesh);
			if (mesh.geometry) mesh.geometry.dispose();
			if (Array.isArray(mesh.material)) {
				mesh.material.forEach((m) => m?.dispose());
			} else if (mesh.material) {
				mesh.material.dispose();
			}
			delete instancedMeshRef.current[id];
		});

		// Set a large initial instance count
		const initialInstanceCount = BLOCK_INSTANCED_MESH_CAPACITY; // Adjust this number based on your expected maximum

		// Initialize meshes for all block types
		blockTypesArray.forEach((blockType) => {
			const geometry = new THREE.BoxGeometry(1, 1, 1);
			const materials = createBlockMaterial(blockType);

			instancedMeshRef.current[blockType.id] = new THREE.InstancedMesh(
				geometry,
				blockType.isMultiTexture ? materials : materials[0],
				initialInstanceCount
			);

			instancedMeshRef.current[blockType.id].userData.blockTypeId = blockType.id;
			instancedMeshRef.current[blockType.id].count = 0;
			instancedMeshRef.current[blockType.id].frustumCulled = false;
			scene.add(instancedMeshRef.current[blockType.id]);
		});
	}
	
	/// Geometry and Material Helper Functions ///
	/// Geometry and Material Helper Functions ///
	/// Geometry and Material Helper Functions ///
	/// Geometry and Material Helper Functions ///

	const createBlockGeometry = (blockType) => {
		if (!blockType) {
			console.error("Invalid blockType:", blockType);
			return new THREE.BoxGeometry(1, 1, 1); // Default fallback
		}

		if (blockType.isEnvironment) {
			if (blockType.textureUri) {
				const texture = new THREE.TextureLoader().load(blockType.textureUri);

				// Set default aspect ratio of 1 initially
				const planeGeometry = new THREE.PlaneGeometry(1, 1);
				const plane1 = planeGeometry.clone();
				const plane2 = planeGeometry.clone();
				plane2.rotateY(Math.PI / 2);

				// Update aspect ratio when texture loads
				texture.onload = () => {
					const aspectRatio = texture.image.width / texture.image.height;
					plane1.scale(aspectRatio, 1, 1);
					plane2.scale(aspectRatio, 1, 1);
					plane1.computeBoundingSphere();
					plane2.computeBoundingSphere();
				};

				return mergeGeometries([plane1, plane2]);
			}
			return new THREE.BoxGeometry(1, 1, 1);
		}

		return new THREE.BoxGeometry(1, 1, 1);
	};

	const createBlockMaterial = (blockType) => {
		if (blockType.isCustom || blockType.id >= 100) {
			const texture = new THREE.TextureLoader().load(blockType.textureUri);
			texture.magFilter = THREE.NearestFilter;
			texture.minFilter = THREE.NearestFilter;
			texture.colorSpace = THREE.SRGBColorSpace;

			// Create material with the loaded texture
			const material = new THREE.MeshPhongMaterial({
				map: texture,
				depthWrite: true,
				depthTest: true,
				transparent: true,
				alphaTest: 0.5,
			});

			// Handle texture loading errors by replacing with error texture
			texture.onerror = () => {
				console.warn(`Error loading texture for custom block ${blockType.name}, using error texture`);
				const errorTexture = new THREE.TextureLoader().load("./assets/blocks/error.png");
				errorTexture.magFilter = THREE.NearestFilter;
				errorTexture.minFilter = THREE.NearestFilter;
				errorTexture.colorSpace = THREE.SRGBColorSpace;
				material.map = errorTexture;
				material.needsUpdate = true;
			};

			return Array(6).fill(material);
		}

		// Order of faces in THREE.js BoxGeometry: right, left, top, bottom, front, back
		const faceOrder = ['+x', '-x', '+y', '-y', '+z', '-z'];
		const materials = [];

		for (const face of faceOrder) {
			let texturePath;
			
			if (blockType.isMultiTexture && blockType.sideTextures[face]) {
				texturePath = blockType.sideTextures[face];
			} else {
				texturePath = blockType.textureUri;
			}

			const texture = new THREE.TextureLoader().load(texturePath);
			texture.magFilter = THREE.NearestFilter;
			texture.minFilter = THREE.NearestFilter;
			texture.colorSpace = THREE.SRGBColorSpace;

			materials.push(
				new THREE.MeshPhongMaterial({
					map: texture,
					color: 0xffffff,
					transparent: true,
					alphaTest: 0.5,
					opacity: texturePath.includes("water") ? 0.5 : 1,
					depthWrite: true,
					depthTest: true,
				})
			);
		}

		return materials;
	};

	/// Placement and Modification Functions ///
	/// Placement and Modification Functions ///
	/// Placement and Modification Functions ///
	/// Placement and Modification Functions ///

	const handleMouseDown = (event) => {
		if (event.button === 0) {
			isPlacingRef.current = true;
			isFirstBlockRef.current = true;
			currentPlacingYRef.current = previewPositionRef.current.y;
			
			// Clear recently placed blocks on mouse down
			recentlyPlacedBlocksRef.current.clear();

			// Store initial position for axis lock
			if (axisLockEnabledRef.current) {
				placementStartPosition.current = previewPositionRef.current.clone();
			}

			// Save the initial state for undo/redo
			placementStartState.current = {
				terrain: { ...terrainRef.current },
				environment: DatabaseManager.getData(STORES.ENVIRONMENT, "current") || []
			};

			// Handle initial placement
			updatePreviewPosition();
			playPlaceSound();
		}
	};

	const handleBlockPlacement = () => {
		if (!modeRef.current || !isPlacingRef.current) return;

		if (currentBlockTypeRef.current?.isEnvironment) {
			if (isFirstBlockRef.current) {
				environmentBuilderRef.current.placeEnvironmentModel(previewPositionRef.current.clone());
				isFirstBlockRef.current = false;
			}
			return;
		}

		const newPlacementPosition = previewPositionRef.current.clone();
		const positions = getPlacementPositions(newPlacementPosition, placementSizeRef.current);
		let terrainChanged = false;

		positions.forEach((pos) => {
			const key = `${pos.x},${pos.y},${pos.z}`;
			const blockMesh = instancedMeshRef.current[currentBlockTypeRef.current.id];

			if (modeRef.current === "add") {
				if (!terrainRef.current[key]) {
					terrainRef.current[key] = currentBlockTypeRef.current.id;
					terrainChanged = true;
					recentlyPlacedBlocksRef.current.add(key);

					// Update instanced mesh directly
					const instanceIndex = blockCountsRef.current[currentBlockTypeRef.current.id] || 0;
					const matrix = new THREE.Matrix4().setPosition(pos.x, pos.y, pos.z);
					blockCountsRef.current[currentBlockTypeRef.current.id] = instanceIndex + 1;
					blockMesh.setMatrixAt(instanceIndex, matrix);
					blockMesh.count = instanceIndex + 1;
					blockMesh.instanceMatrix.needsUpdate = true;
				}
			} else if (modeRef.current === "remove") {
				if (terrainRef.current[key]) {
					delete terrainRef.current[key];
					terrainChanged = true;
					// Mark for rebuild since removal is more complex
					meshesNeedsRefresh = true;
				}
			}
		});

		if (isFirstBlockRef.current) {
			isFirstBlockRef.current = false;
		}

		if (terrainChanged) {
			totalBlocksRef.current = Object.keys(terrainRef.current).length;
			updateDebugInfo();

			// Save terrain to storage asynchronously
			DatabaseManager.saveData(STORES.TERRAIN, "current", terrainRef.current)
				.catch(error => console.error("Error saving terrain:", error));

			if (meshesNeedsRefresh) {
				buildUpdateTerrain(); // Only rebuild if necessary (e.g., removal)
				meshesNeedsRefresh = false;
			}
		}
	};

	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///

	const getRaycastIntersection = (raycastOrigin) => {
		const raycastIntersects = raycastOrigin.intersectObjects(scene.children, false);

		if (!raycastIntersects.length) return null;

		// Filter intersections to only consider active instances
		const rayHitBlock = raycastIntersects.find(intersect => {
			if (intersect.object.isInstancedMesh) {
				return intersect.instanceId !== undefined && intersect.instanceId < intersect.object.count;
			}
			return false;
		});

		const rayHitShadowPlane = raycastIntersects.find(intersect => intersect.object === shadowPlaneRef.current);

		if (rayHitBlock) {
			return {
				point: rayHitBlock.point,
				normal: rayHitBlock.face.normal,
			};
		}

		if (rayHitShadowPlane) {
			return {
				point: new THREE.Vector3(
					rayHitShadowPlane.point.x,
					0,
					rayHitShadowPlane.point.z
				),
				normal: rayHitShadowPlane.face.normal,
			};
		}

		return null;
	};

	// Throttle mouse move updates
	const updatePreviewPosition = () => {
		// Skip update if we updated too recently
		const now = performance.now();
		if (now - updatePreviewPosition.lastUpdate < 10) { // ~60fps
			return;
		}
		updatePreviewPosition.lastUpdate = now;

		// Cache the canvas rect calculation
		if (!canvasRectRef.current) {
			canvasRectRef.current = gl.domElement.getBoundingClientRect();
		}

		const rect = canvasRectRef.current;

		// Reuse vectors for normalized mouse position
		normalizedMouseRef.current.x = ((((mouse.x + 1) / 2) * rect.width - rect.width / 2) / rect.width) * 2;
		normalizedMouseRef.current.y = ((((mouse.y + 1) / 2) * rect.height - rect.height / 2) / rect.height) * 2;

		// Update raycaster
		raycaster.ray.origin.copy(camera.position);
		raycaster.ray.direction
			.set(normalizedMouseRef.current.x, normalizedMouseRef.current.y, 0.5)
			.unproject(camera)
			.sub(camera.position)
			.normalize();

		const intersection = getRaycastIntersection(raycaster);
		if (!intersection) return;

		if (!currentBlockTypeRef?.current?.isEnvironment) {
			// Reuse vector for grid position calculation
			tempVectorRef.current.copy(intersection.point);
			
			// Apply mode-specific adjustments
			if (modeRef.current === "remove") {
				tempVectorRef.current.x = Math.round(tempVectorRef.current.x - intersection.normal.x * 0.5);
				tempVectorRef.current.y = Math.round(tempVectorRef.current.y - intersection.normal.y * 0.5);
				tempVectorRef.current.z = Math.round(tempVectorRef.current.z - intersection.normal.z * 0.5);
			} else {
				// For add mode, add a small offset in the normal direction before rounding
				tempVectorRef.current.add(intersection.normal.clone().multiplyScalar(0.01));
				tempVectorRef.current.x = Math.round(tempVectorRef.current.x);
				tempVectorRef.current.y = Math.round(tempVectorRef.current.y);
				tempVectorRef.current.z = Math.round(tempVectorRef.current.z);
			}

			// Maintain Y position during placement
			if (isPlacingRef.current) {
				tempVectorRef.current.y = currentPlacingYRef.current;
			}

			// Apply axis lock if needed
			if (axisLockEnabledRef.current && isPlacingRef.current) {
				if (!lockedAxisRef.current && !isFirstBlockRef.current) {
					// Determine which axis to lock based on movement
					const newAxis = determineLockedAxis(tempVectorRef.current);
					if (newAxis) {
						lockedAxisRef.current = newAxis;
						console.log("Axis locked to:", newAxis); // Debug log
					}
				}

				if (lockedAxisRef.current) {
					// Lock movement to the determined axis
					if (lockedAxisRef.current === 'x') {
						tempVectorRef.current.z = placementStartPosition.current.z;
					} else {
						tempVectorRef.current.x = placementStartPosition.current.x;
					}
				}
			}

			// Check if we've moved enough to update the preview position
			// This adds hysteresis to prevent small jitters
			if (!isFirstBlockRef.current && isPlacingRef.current) {
				tempVec2Ref.current.set(lastPreviewPositionRef.current.x, lastPreviewPositionRef.current.z);
				tempVec2_2Ref.current.set(tempVectorRef.current.x, tempVectorRef.current.z);
				if (tempVec2Ref.current.distanceTo(tempVec2_2Ref.current) < THRESHOLD_FOR_PLACING) {
					return;
				}
			}

			// Only update if the position has actually changed
			if (!previewPositionRef.current.equals(tempVectorRef.current)) {
				previewPositionRef.current.copy(tempVectorRef.current);
				// Store the constrained position, not the raw intersection point
				lastPreviewPositionRef.current.copy(tempVectorRef.current);
				setPreviewPosition(previewPositionRef.current.clone());
				updateDebugInfo();
			}
		} else {
			// Handle environment objects
			const envPosition = intersection.point.clone();
			
			// For environment objects, we want to snap the Y position to the nearest integer
			// and add 0.5 to place them on top of blocks rather than halfway through
			envPosition.y = Math.ceil(envPosition.y);
			
			previewPositionRef.current.copy(envPosition);
			lastPreviewPositionRef.current.copy(envPosition);
			setPreviewPosition(envPosition);
			previewPositionToAppJS(envPosition);
			updateDebugInfo();
		}

		if (previewMeshRef.current) {
			previewMeshRef.current.position.copy(previewPositionRef.current);
			previewMeshRef.current.updateMatrix();
		}

		if (isPlacingRef.current) {
			handleBlockPlacement();
		}
	};

	updatePreviewPosition.lastUpdate = 0;

	// Move undo state saving to handlePointerUp
	const handleMouseUp = (event) => {
		if (event.button === 0) {
			isPlacingRef.current = false;
			// Clear recently placed blocks
			recentlyPlacedBlocksRef.current.clear();

			if (placementStartState.current) {
				// Gather current state
				const currentState = {
					terrain: { ...terrainRef.current },
					environment: DatabaseManager.getData(STORES.ENVIRONMENT, "current") || [],
				};

				// Each "undo" record stores only the blocks added or removed during this drag
				const changes = {
					terrain: {
						added: {},
						removed: {},
					},
					environment: {
						added: [],
						removed: [],
					},
				};

				// Compare old & new terrain for added/removed
				Object.entries(currentState.terrain).forEach(([key, value]) => {
					if (!placementStartState.current.terrain[key]) {
						changes.terrain.added[key] = value;
					}
				});
				Object.entries(placementStartState.current.terrain).forEach(([key, value]) => {
					if (!currentState.terrain[key]) {
						changes.terrain.removed[key] = value;
					}
				});

				if (
					Object.keys(changes.terrain.added).length > 0 ||
					Object.keys(changes.terrain.removed).length > 0
				) {
					// Save Undo
					undoRedoManager.saveUndo(changes);
				}

				// Clear out the "start state"
				placementStartState.current = null;
			}

			// If axis lock was on, reset
			if (axisLockEnabled) {
				lockedAxisRef.current = null;
				placementStartPosition.current = null;
			}
		}
	};

	const getPlacementPositions = (centerPos, placementSize) => {
		const positions = [];

		// Always include center position
		positions.push({ ...centerPos });

		switch (placementSize) {
			default:
			case "single":
				break;

			case "cross":
				positions.push({ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z }, { x: centerPos.x - 1, y: centerPos.y, z: centerPos.z }, { x: centerPos.x, y: centerPos.y, z: centerPos.z + 1 }, { x: centerPos.x, y: centerPos.y, z: centerPos.z - 1 });
				break;

			case "diamond":
				// 13-block diamond pattern
				positions.push(
					// Inner cardinal positions (4 blocks)
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z - 1 },
					// Middle diagonal positions (4 blocks)
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x + 1, y: centerPos.y, z: centerPos.z - 1 },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z + 1 },
					{ x: centerPos.x - 1, y: centerPos.y, z: centerPos.z - 1 },
					// Outer cardinal positions (4 blocks)
					{ x: centerPos.x + 2, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x - 2, y: centerPos.y, z: centerPos.z },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z + 2 },
					{ x: centerPos.x, y: centerPos.y, z: centerPos.z - 2 }
				);
				break;

			case "square9":
				for (let x = -1; x <= 1; x++) {
					for (let z = -1; z <= 1; z++) {
						if (x !== 0 || z !== 0) {
							// Skip center as it's already added
							positions.push({
								x: centerPos.x + x,
								y: centerPos.y,
								z: centerPos.z + z,
							});
						}
					}
				}
				break;

			case "square16":
				for (let x = -2; x <= 1; x++) {
					for (let z = -2; z <= 1; z++) {
						if (x !== 0 || z !== 0) {
							// Skip center as it's already added
							positions.push({
								x: centerPos.x + x,
								y: centerPos.y,
								z: centerPos.z + z,
							});
						}
					}
				}
				break;
		}

		return positions;
	};

	const getCurrentTerrainData = () => {
		return terrainRef.current;
	};

	const determineLockedAxis = (currentPos) => {
		if (!placementStartPosition.current || !axisLockEnabledRef.current) return null;

		const xDiff = Math.abs(currentPos.x - placementStartPosition.current.x);
		const zDiff = Math.abs(currentPos.z - placementStartPosition.current.z);

		// Only lock axis if we've moved enough to determine direction
		// and one axis has significantly more movement than the other
		if (Math.max(xDiff, zDiff) > THRESHOLD_FOR_PLACING) {
			// Require one axis to have at least 50% more movement than the other
			if (xDiff > zDiff * 1.5) {
				return 'x';
			} else if (zDiff > xDiff * 1.5) {
				return 'z';
			}
		}
		return null;
	};


	const updateTerrainFromToolBar = (terrainData) => {
		terrainRef.current = terrainData;
		console.log("Calling Build Update Terrain from updateTerrainFromToolBar");
		buildUpdateTerrain();
	};

	// Update
	const updateGridSize = (newGridSize) => {
		if (gridRef.current) {
			// Get grid size from localStorage or use default value
			const savedGridSize = parseInt(localStorage.getItem("gridSize"), 10) || newGridSize;

			if (gridRef.current.geometry) {
				gridRef.current.geometry.dispose();
				gridRef.current.geometry = new THREE.GridHelper(savedGridSize, savedGridSize, 0x5c5c5c, 0xeafaea).geometry;
				gridRef.current.material.opacity = 0.1;
				gridRef.current.position.set(0.5, -0.5, 0.5);
			}

			if (shadowPlaneRef.current.geometry) {
				shadowPlaneRef.current.geometry.dispose();
				shadowPlaneRef.current.geometry = new THREE.PlaneGeometry(savedGridSize, savedGridSize);
				shadowPlaneRef.current.position.set(0.5, -0.5, 0.5);
			}
		}
	};

	const updateDebugInfo = () => {
		setDebugInfo({
			preview: previewPositionRef.current,
			totalBlocks: totalBlocksRef.current,
		});
	}

	const clearMap = () => {
		// Clear environment data first
		DatabaseManager.clearStore(STORES.ENVIRONMENT)
			.then(() => {
				// Clear environment objects
				environmentBuilderRef.current.clearEnvironments();
				
				// Clear terrain data
				return DatabaseManager.clearStore(STORES.TERRAIN);
			})
			.then(() => {
				// Clear undo/redo history
				return Promise.all([
					DatabaseManager.saveData(STORES.UNDO, "states", []),
					DatabaseManager.saveData(STORES.REDO, "states", [])
				]);
			})
			.then(() => {
				// Update local terrain state
				terrainRef.current = {};
				console.log("Calling Build Update Terrain from clearMap");
				buildUpdateTerrain();
				totalBlocksRef.current = 0;
			})
			.catch(error => {
				console.error("Error clearing map data:", error);
			});
	}

	// Update mousemove effect to use requestAnimationFrame
	useEffect(() => {
		let animationFrameId;
		
		const handleMouseMove = () => {
			animationFrameId = requestAnimationFrame(updatePreviewPosition);
		};

		window.addEventListener("mousemove", handleMouseMove);
		
		return () => {
			window.removeEventListener("mousemove", handleMouseMove);
			if (animationFrameId) {
				cancelAnimationFrame(animationFrameId);
			}
		};
	}, []);

	// Define camera reset effects and axis lock effects
	useEffect(() => {
		if (cameraReset) {
			cameraManager.resetCamera();
		}
	}, [cameraReset]);

	useEffect(() => {
		cameraManager.handleSliderChange(cameraAngle);
	}, [cameraAngle]);

	useEffect(() => {
		axisLockEnabledRef.current = axisLockEnabled;
		console.log("Axis lock status:", axisLockEnabled);
	}, [axisLockEnabled]);

	// effect to update grid size
	useEffect(() => {
		updateGridSize(gridSize);
	}, [gridSize]);

	// Add this effect to disable frustum culling
	useEffect(() => {
		// Disable frustum culling on camera
		camera.frustumCulled = false;
		
		// Disable frustum culling on all scene objects
		scene.traverse((object) => {
			if (object.isMesh || object.isInstancedMesh) {
				object.frustumCulled = false;
			}
		});
	}, [camera, scene]);

	// Initialize instanced meshes and load terrain from IndexedDB
	useEffect(() => {
		let mounted = true;

		function initialize() {
			// Initialize camera manager with camera and controls
			cameraManager.initialize(camera, orbitControlsRef.current);

			// Load skybox
			const loader = new THREE.CubeTextureLoader();
			loader.setPath("./assets/skyboxes/partly-cloudy/");
			const textureCube = loader.load(["+x.png", "-x.png", "+y.png", "-y.png", "+z.png", "-z.png"]);
			scene.background = textureCube;

			// Initialize meshes
			// Initialize only block types, environment models are handled by EnvironmentBuilder
			const initialInstanceCount = BLOCK_INSTANCED_MESH_CAPACITY; // Match the capacity used in refreshBlockMeshes

			for (const type of blockTypesArray) {
				let geometry = createBlockGeometry(type);
				let material = createBlockMaterial(type);

				instancedMeshRef.current[type.id] = new THREE.InstancedMesh(
					geometry,
					Array.isArray(material) ? material : material[0],
					initialInstanceCount
				);
				instancedMeshRef.current[type.id].frustumCulled = false;
				instancedMeshRef.current[type.id].renderOrder = 1;
				instancedMeshRef.current[type.id].userData.blockTypeId = type.id;
				instancedMeshRef.current[type.id].count = 0;
				scene.add(instancedMeshRef.current[type.id]);
			}

			if (!mounted){
				console.log("Initializing mesh: UHHOH! not mounted");
				return;
			}

			// Load custom blocks from IndexedDB
			DatabaseManager.getData(STORES.CUSTOM_BLOCKS, "blocks")
				.then((customBlocksData) => {
					if (customBlocksData && customBlocksData.length > 0) {
						console.log("Loading custom blocks from IndexedDB:", customBlocksData.length);
						// Update block types with custom blocks
						addCustomBlocks(customBlocksData);
						
						// Initialize meshes for custom blocks
						const initialInstanceCount = BLOCK_INSTANCED_MESH_CAPACITY; // Match the initial capacity used elsewhere

						for (const blockType of customBlocksData) {
							if (!instancedMeshRef.current[blockType.id]) {
								const geometry = new THREE.BoxGeometry(1, 1, 1);
								const materials = createBlockMaterial(blockType);

								instancedMeshRef.current[blockType.id] = new THREE.InstancedMesh(
									geometry,
									materials[0],
									initialInstanceCount
								);

								instancedMeshRef.current[blockType.id].userData.blockTypeId = blockType.id;
								instancedMeshRef.current[blockType.id].count = 0;
								instancedMeshRef.current[blockType.id].frustumCulled = false;
								scene.add(instancedMeshRef.current[blockType.id]);
							}
						}
						
						// Notify the app that custom blocks were loaded
						window.dispatchEvent(new CustomEvent('custom-blocks-loaded', {
							detail: { blocks: customBlocksData }
						}));
					}
					
					meshesInitializedRef.current = true;
					console.log("Meshes INITIALIZED LETS GOoooo! Status: ", meshesInitializedRef.current);

					// Load terrain from IndexedDB
					return DatabaseManager.getData(STORES.TERRAIN, "current");
				})
				.then((savedTerrain) => {
					if (!mounted) return;

					if (savedTerrain) {
						terrainRef.current = savedTerrain;
						console.log("Terrain loaded from IndexedDB");
						totalBlocksRef.current = Object.keys(terrainRef.current).length;
					} else {
						console.log("No terrain found in IndexedDB");
						// Initialize with empty terrain
						terrainRef.current = {};
						console.log("Calling Build Update Terrain from Initialization useEffect (empty terrain)");
						buildUpdateTerrain();
						totalBlocksRef.current = 0;
					}

					setPageIsLoaded(true);
				})
				.catch((error) => {
					console.error("Error loading terrain or custom blocks:", error);
					if (mounted) {
						meshesInitializedRef.current = true;
						terrainRef.current = {};
						console.log("Calling Build Update Terrain from Initialization useEffect (error)");
						buildUpdateTerrain();
						totalBlocksRef.current = 0;
						setPageIsLoaded(true);
					}
				});
		}

		initialize();

		return () => {
			mounted = false; // Prevent state updates after unmount
		};
	}, [camera, scene]);

	// Cleanup effect that cleans up meshes when component unmounts
	useEffect(() => {
		return () => {
			// Cleanup meshes when component unmounts
			Object.values(instancedMeshRef.current).forEach((mesh) => {
				if (mesh) {
					scene.remove(mesh);
					if (mesh.geometry) mesh.geometry.dispose();
					if (Array.isArray(mesh.material)) {
						mesh.material.forEach((m) => m?.dispose());
					} else if (mesh.material) {
						mesh.material.dispose();
					}
				}
			});
		};
	}, [scene]); // Empty dependency array means this only runs on unmount

	// effect to refresh meshes when the meshesNeedsRefresh flag is true
	useEffect(() => {
		if (meshesNeedsRefresh) {
			console.log("Refreshing instance meshes due to new custom blocks");
			refreshBlockMeshes();
			buildUpdateTerrain();
			meshesNeedsRefresh = false;
		}
	}, [meshesNeedsRefresh]);

	// effect to update current block type reference when the prop changes
	useEffect(() => {
		currentBlockTypeRef.current = currentBlockType;
	}, [currentBlockType]);

	// Add this effect to update the mode ref when the prop changes
	useEffect(() => {
		modeRef.current = mode;
	}, [mode]);

	// Add this effect to update the ref when placementSize changes
	useEffect(() => {
		placementSizeRef.current = placementSize;
	}, [placementSize]);

	/// build update terrain when the terrain state changes
	useEffect(() => {
		console.log("Calling Build Update Terrain from useEffect (terrain state changed)");
		buildUpdateTerrain();
	}, [terrainRef.current]);

	/// onSceneReady send the scene to App.js via a setter
	useEffect(() => {
		if (scene && onSceneReady) {
			onSceneReady(scene);
		}
	}, [scene, onSceneReady]);

	// Expose buildUpdateTerrain and clearMap via ref
	React.useImperativeHandle(ref, () => ({
		buildUpdateTerrain,
		updateTerrainFromToolBar,
		getCurrentTerrainData,
		clearMap,
		/**
		 * Force a DB reload of terrain and then rebuild it
		 */
		async refreshTerrainFromDB() {
			try {
				const saved = await DatabaseManager.getData(STORES.TERRAIN, "current");
				console.log("Refreshing terrain from DB, found blocks:", saved ? Object.keys(saved).length : 0);
				if (saved) {
					terrainRef.current = saved;
				} else {
					terrainRef.current = {};
				}
				console.log("Calling Build Update Terrain from refreshTerrainFromDB");
				buildUpdateTerrain();
			} catch (err) {
				console.error("Error reloading terrain from DB:", err);
			}
		},
	}));

	// Add resize listener to update canvasRect
	useEffect(() => {
		const handleResize = () => {
			canvasRectRef.current = null; // Force recalculation on next update
		};
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, []);

	//// HTML Return Render
	return (
		<>
			<OrbitControls
				ref={orbitControlsRef}
				enablePan={true}
				enableZoom={false}
				enableRotate={true}
				mouseButtons={{
					MIDDLE: THREE.MOUSE.PAN,
					RIGHT: THREE.MOUSE.ROTATE,
				}}
			/>

			{/* Shadow directional light */}
			<directionalLight
				ref={directionalLightRef}
				position={[10, 20, 10]}
				intensity={2}
				color={0xffffff}
				castShadow={true}
				shadow-mapSize-width={2048}
				shadow-mapSize-height={2048}
				shadow-camera-far={1000}
				shadow-camera-near={10}
				shadow-camera-left={-100}
				shadow-camera-right={100}
				shadow-camera-top={100}
				shadow-camera-bottom={-100}
				shadow-bias={0.00005}
				shadow-normalBias={0.1}
			/>

			{/* Non shadow directional light */}
			<directionalLight
				position={[10, 20, 10]}
				intensity={1}
				color={0xffffff}
				castShadow={false}
			/>

			{/* Ambient light */}
			<ambientLight intensity={0.8} />

			{/* mesh of invisible plane to receive shadows, and grid helper to display grid */}
			<mesh
				ref={shadowPlaneRef}
				position={[0.5, -0.51, 0.5]}
				rotation={[-Math.PI / 2, 0, 0]}
				onPointerDown={handleMouseDown}
				onPointerUp={handleMouseUp}
				transparent={true}
				receiveShadow={true}
				castShadow={false}
				frustumCulled={false}>
				<planeGeometry args={[gridSize, gridSize]} />
				<meshPhongMaterial
					transparent
					opacity={0}
				/>
			</mesh>
			<gridHelper
				position={[0.5, -0.5, 0.5]}
				ref={gridRef}
			/>

			{Object.entries(blockCountsRef.current).map(([id]) => (
				<primitive
					s
					key={id}
					object={instancedMeshRef.current[id]}
					castShadow
					receiveShadow
				/>
			))}

			{previewPosition && (modeRef.current === "add" || modeRef.current === "remove") && (
				<group>
					{getPlacementPositions(previewPosition, placementSizeRef.current).map((pos, index) => (
						<group
							key={index}
							position={[pos.x, pos.y, pos.z]}>
							<mesh renderOrder={2}>
								<boxGeometry args={[1.02, 1.02, 1.02]} />
								<meshPhongMaterial
									color={modeRef.current === "add" ? "green" : "red"}
									opacity={0.4}
									transparent={true}
									depthWrite={false}
									depthTest={true}
									alphaTest={0.1}
								/>
							</mesh>
							<lineSegments renderOrder={3}>
								<edgesGeometry args={[new THREE.BoxGeometry(1, 1, 1)]} />
								<lineBasicMaterial
									color="darkgreen"
									linewidth={2}
								/>
							</lineSegments>
						</group>
					))}
				</group>
			)}
		</>
	);
}

// Convert to forwardRef
export default forwardRef(TerrainBuilder);


