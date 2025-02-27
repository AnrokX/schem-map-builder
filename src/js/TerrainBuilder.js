import React, { useRef, useEffect, useState, forwardRef } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { playPlaceSound } from "./Sound";
import { cameraManager } from "./Camera";
import { DatabaseManager, STORES } from "./DatabaseManager";
import { AXIS_LOCK_THRESHOLD, THRESHOLD_FOR_PLACING } from "./Constants";

let terrainRef = {};

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
					sides: [],
					sideTextures: {},
				});
			}

			if (side) {
				const sideKey = side.slice(1);
				blockMap.get(blockName).sides.push(sideKey);
				blockMap.get(blockName).sideTextures[sideKey] = `./assets/blocks/${blockName}${side}.png`;
			}
		}
	});

	return Array.from(blockMap.values()).map((block) => ({
		...block,
		isMultiTexture: block.sides.length > 0,
		isEnvironment: false,
	}));
})();

// Add function to update blockTypes with custom blocks
export const updateBlockTypes = (customBlocks) => {
	blockTypesArray = [
		...blockTypesArray,
		...customBlocks.map((block) => ({
			...block,
			isMultiTexture: false,
			isEnvironment: false,
			// Mark blocks that use error texture as having missing textures
			hasMissingTexture: block.textureUri === "./assets/blocks/error/error.png",
		})),
	];
	return blockTypesArray;
};
// Export the blockTypes getter
export const getBlockTypes = () => blockTypesArray;
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
		console.log("building update terrain: called");

		if (!scene || !meshesInitializedRef.current){
			console.log("building update terrain: not ready");
			return;
		}

		//console.log("building update terrain: called");
		const blockCountsByType = {};
		const transformMatrix = new THREE.Matrix4();

		// Reset instance counts for all mesh types
		Object.values(instancedMeshRef.current).forEach((instancedMesh) => {
			instancedMesh.count = 0;
		});

		// Process each block in the terrain
		Object.entries(terrainRef.current).forEach(([position, block]) => {
			const [x, y, z] = position.split(",").map(Number);

			// Skip environment objects - they're handled by EnvironmentBuilder
			if (block.isEnvironment) return;

			// Get the block mesh
			const blockMesh = instancedMeshRef.current[block.id];

			// If the block mesh exists, update it
			if (blockMesh) {
				//console.log("building update terrain: updating block mesh");
				const instanceIndex = blockCountsByType[block.id] || 0;

				// Resize instance buffer if needed
				if (instanceIndex >= blockMesh.instanceMatrix.count) {
					const expandedSize = Math.ceil(blockMesh.instanceMatrix.count * 1.5) + 1;
					const resizedMesh = new THREE.InstancedMesh(blockMesh.geometry, blockMesh.material, Math.max(expandedSize, 10));
					resizedMesh.count = blockMesh.count;
					resizedMesh.instanceMatrix.set(blockMesh.instanceMatrix.array);

					scene.remove(blockMesh);
					scene.add(resizedMesh);
					instancedMeshRef.current[block.id] = resizedMesh;
				}

				// Set block position in world space
				transformMatrix.identity();
				transformMatrix.setPosition(x, y, z);
				instancedMeshRef.current[block.id].setMatrixAt(instanceIndex, transformMatrix);
				blockCountsByType[block.id] = instanceIndex + 1;
			}
		});

		// Update instance counts and trigger matrix updates
		Object.entries(blockCountsByType).forEach(([blockId, instanceCount]) => {
			const blockMesh = instancedMeshRef.current[blockId];
			blockMesh.count = instanceCount;
			blockMesh.instanceMatrix.needsUpdate = true;
		});

		// Update UI block counts
		blockCountsRef.current = blockCountsByType.length;

		// Update block counts
		blockCountsRef.current = blockCountsByType;
		totalBlocksRef.current = Object.keys(terrainRef.current).length;

		updateDebugInfo();

		// Save terrain to storage
		DatabaseManager.saveData(STORES.TERRAIN, "current", terrainRef.current)
			.catch(error => console.error("Error saving terrain:", error));
	};

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
		if (blockType.isCustom) {
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
				const errorTexture = new THREE.TextureLoader().load("./assets/blocks/error/error.png");
				errorTexture.magFilter = THREE.NearestFilter;
				errorTexture.minFilter = THREE.NearestFilter;
				errorTexture.colorSpace = THREE.SRGBColorSpace;
				material.map = errorTexture;
				material.needsUpdate = true;
			};

			return Array(6).fill(material);
		}

		const sides = ["+x", "-x", "+y", "-y", "+z", "-z"];
		const materials = [];

		for (const side of sides) {
			const sideTexture = `./assets/blocks/${blockType.name}/${side}.png`;
			const fallbackTexture = `./assets/blocks/${blockType.name}.png`;

			let texture;

			try {
				const loadTexture = (path) => {
					const texture = new THREE.TextureLoader().load(path);
					return texture;
				};

				if (blockType.isMultiTexture && blockType.sides.includes(side)) {
					texture = loadTexture(sideTexture);
				} else {
					texture = loadTexture(fallbackTexture);
					if (blockType.isMultiTexture) {
						console.warn(`Missing side texture for ${blockType.name}, using single texture for all faces`);
						const material = new THREE.MeshPhongMaterial({
							map: texture,
							color: 0xffffff,
							transparent: true,
							alphaTest: 0.5,
							opacity: texture.name?.includes("water") ? 0.5 : 1,
						});
						return Array(6).fill(material);
					}
				}

				texture.magFilter = THREE.NearestFilter;
				texture.minFilter = THREE.NearestFilter;
				texture.colorSpace = THREE.SRGBColorSpace;

				materials.push(
					new THREE.MeshPhongMaterial({
						map: texture,
						color: 0xffffff,
						transparent: true,
						alphaTest: 0.5,
						opacity: texture.name?.includes("water") ? 0.5 : 1,
						depthWrite: true,
						depthTest: true,
					})
				);
			} catch (error) {
				console.error(`Error loading texture for ${blockType.name}:`, error);
				// Load error texture instead
				const errorTexture = new THREE.TextureLoader().load("./assets/blocks/error/error.png");
				errorTexture.magFilter = THREE.NearestFilter;
				errorTexture.minFilter = THREE.NearestFilter;
				errorTexture.colorSpace = THREE.SRGBColorSpace;

				const errorMaterial = new THREE.MeshPhongMaterial({
					map: errorTexture,
					color: 0xffffff,
				});
				return Array(6).fill(errorMaterial);
			}
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

		// Handle environment models separately
		// we only place one environment model at a time
		if (currentBlockTypeRef.current?.isEnvironment && isFirstBlockRef.current === true) {
			environmentBuilderRef.current.placeEnvironmentModel(previewPositionRef.current.clone());
			isFirstBlockRef.current = false;
			return;
		}
		else if (currentBlockTypeRef.current?.isEnvironment && isFirstBlockRef.current === false) {
			return;
		}

		const newPlacementPosition = previewPositionRef.current.clone();

		// Get all positions to place/remove blocks
		const positions = getPlacementPositions(newPlacementPosition, placementSizeRef.current);
		let terrainChanged = false;

		positions.forEach((pos) => {
			const key = `${pos.x},${pos.y},${pos.z}`;
			if (modeRef.current === "add") {
				// Only place if there isn't already a block here
				if (!terrainRef.current[key]) {
					terrainRef.current[key] = { ...currentBlockTypeRef.current };
					terrainChanged = true;
					// Add to recently placed blocks
					recentlyPlacedBlocksRef.current.add(key);
				}
			} else if (modeRef.current === "remove") {
				if (terrainRef.current[key]) {
					delete terrainRef.current[key];
					terrainChanged = true;
				}
			}
		});

		if (terrainChanged) {
			buildUpdateTerrain();
			totalBlocksRef.current = Object.keys(terrainRef.current).length;
		}
	};

	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///

	const getRaycastIntersection = (raycastOrigin) => {
		// Remove the filtering that's causing problems
		const raycastIntersects = raycastOrigin.intersectObjects(scene.children);
		
		if (!raycastIntersects.length) return null;

		// First, try to find a valid block intersection
		let rayHitBlock = null;
		let rayHitShadowPlane = null;

		// First pass: find any block intersection and the shadow plane
		for (const intersect of raycastIntersects) {
			if (intersect.object.isInstancedMesh) {
				const blockPos = new THREE.Vector3().copy(intersect.point).sub(intersect.face.normal.multiplyScalar(0.5));
				const roundedPos = new THREE.Vector3(
					Math.round(blockPos.x),
					Math.round(blockPos.y),
					Math.round(blockPos.z)
				);
				
				const posKey = `${roundedPos.x},${roundedPos.y},${roundedPos.z}`;
				if (!recentlyPlacedBlocksRef.current.has(posKey)) {
					rayHitBlock = intersect;
					break; // Found a valid block intersection, no need to check further
				}
			} else if (intersect.object === shadowPlaneRef.current) {
				rayHitShadowPlane = intersect;
			}
		}

		// Always prioritize block intersections over shadow plane
		if (rayHitBlock) {
			return {
				point: rayHitBlock.point,
				normal: rayHitBlock.face.normal,
			};
		}
		
		if (rayHitShadowPlane) {
			const startingPosition = new THREE.Vector3(rayHitShadowPlane.point.x, 0, rayHitShadowPlane.point.z);
			return {
				point: startingPosition,
				normal: rayHitShadowPlane.face.normal,
			};
		}

		return null;
	};

	const calculateGridPosition = (intersection, mode, faceNormal) => {
		if (!intersection) return null;

		let position;
		// For add mode, offset slightly from the face
		position = intersection.point.clone().add(faceNormal.multiplyScalar(0.01));

		if (mode === "remove") {
			position.x = Math.round(position.x - faceNormal.x * 5);
			position.y = Math.round(position.y - faceNormal.y * 5);
			position.z = Math.round(position.z - faceNormal.z * 5);
		} else if (!currentBlockTypeRef?.current?.isEnvironment) {
			position.x = Math.round(position.x);
			position.y = Math.round(position.y);
			position.z = Math.round(position.z);
		} else {
			position.y = Math.round(position.y);
		}

		return position;
	};

	const applyAxisLock = (position, startPosition, lockedAxis) => {
		if (!startPosition || !lockedAxis) return position;

		const diff = new THREE.Vector3().subVectors(position, startPosition);
		const constrained = startPosition.clone();
		constrained[lockedAxis] += diff[lockedAxis];
		return constrained;
	};

	// Function to update preview position based on mouse position
	const updatePreviewPosition = () => {
		// Cache the canvas rect calculation outside the update loop
		// since it rarely changes
		if (!canvasRectRef.current) {
			canvasRectRef.current = gl.domElement.getBoundingClientRect();
		}

		// Use cached rect
		const rect = canvasRectRef.current;

		// Reuse vectors instead of creating new ones
		normalizedMouseRef.current.x = ((((mouse.x + 1) / 2) * rect.width - rect.width / 2) / rect.width) * 2;
		normalizedMouseRef.current.y = ((((mouse.y + 1) / 2) * rect.height - rect.height / 2) / rect.height) * 2;

		// Use the same raycaster instead of setting from scratch
		raycaster.ray.origin.copy(camera.position);
		raycaster.ray.direction
			.set(normalizedMouseRef.current.x, normalizedMouseRef.current.y, 0.5)
			.unproject(camera)
			.sub(camera.position)
			.normalize();

		const intersection = getRaycastIntersection(raycaster);

		if (!intersection) {
			// Don't update if we don't have an intersection
			// This prevents the preview from disappearing during jitter
			return;
		}

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

			// Apply axis lock if needed
			if (axisLockEnabledRef.current && lockedAxisRef.current && placementStartPosition.current) {
				const constrained = placementStartPosition.current.clone();
				constrained[lockedAxisRef.current] = tempVectorRef.current[lockedAxisRef.current];
				tempVectorRef.current.copy(constrained);
			}

			// Maintain Y position during placement
			if (isPlacingRef.current) {
				tempVectorRef.current.y = currentPlacingYRef.current;
			}

			// Check if we've moved enough to update the preview position
			// This adds hysteresis to prevent small jitters
			if (!isFirstBlockRef.current && isPlacingRef.current) {
				tempVec2Ref.current.set(lastPreviewPositionRef.current.x, lastPreviewPositionRef.current.z);
				tempVec2_2Ref.current.set(intersection.point.x, intersection.point.z);
				if (tempVec2Ref.current.distanceTo(tempVec2_2Ref.current) < THRESHOLD_FOR_PLACING) {
					return;
				}
			}

			// Only update if the position has actually changed
			if (!previewPositionRef.current.equals(tempVectorRef.current)) {
				previewPositionRef.current.copy(tempVectorRef.current);
				lastPreviewPositionRef.current.copy(intersection.point);
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
			lastPreviewPositionRef.current.copy(intersection.point);
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

	// Update the useEffect that handles custom blocks
	useEffect(() => {
		if (!meshesInitializedRef.current) return;

		const currentCustomBlockIds = new Set(customBlocks.map((block) => block.id));

		// Clean up removed custom blocks
		Object.entries(instancedMeshRef.current).forEach(([id, mesh]) => {
			const numericId = parseInt(id);
			if (numericId >= 500 && !currentCustomBlockIds.has(numericId)) {
				scene.remove(mesh);
				if (mesh.geometry) mesh.geometry.dispose();
				if (Array.isArray(mesh.material)) {
					mesh.material.forEach((m) => m?.dispose());
				} else if (mesh.material) {
					mesh.material.dispose();
				}
				delete instancedMeshRef.current[id];
			}
		});

		// Initialize new custom blocks
		customBlocks.forEach((blockType) => {
			if (!instancedMeshRef.current[blockType.id]) {
				const geometry = new THREE.BoxGeometry(1, 1, 1);
				const materials = createBlockMaterial(blockType);

				instancedMeshRef.current[blockType.id] = new THREE.InstancedMesh(
					geometry,
					materials[0], // Use first material for all faces
					1
				);

				instancedMeshRef.current[blockType.id].userData.blockTypeId = blockType.id;
				instancedMeshRef.current[blockType.id].count = 0;
				scene.add(instancedMeshRef.current[blockType.id]);
			}
		});
	}, [customBlocks, scene]);

	const getCurrentTerrainData = () => {
		return terrainRef.current;
	};

	const updateTerrainFromToolBar = (terrainData) => {
		terrainRef.current = terrainData;
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
			lockedAxis: axisLockEnabled ? lockedAxisRef.current : "None",
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
				buildUpdateTerrain();
				totalBlocksRef.current = 0;
			})
			.catch(error => {
				console.error("Error clearing map data:", error);
			});
	}

	/// Mouse move update preview position and handle block placement if mouse is down
	useEffect(() => {
		const handleMouseMove = (event) => {
			updatePreviewPosition();
		};
		updatePreviewPosition();

		window.addEventListener("mousemove", handleMouseMove);
		return () => window.removeEventListener("mousemove", handleMouseMove);
	}, []); // Keep empty dependency array since we want latest value from closure

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
			for (const type of blockTypes) {
				let geometry = createBlockGeometry(type);
				let material = createBlockMaterial(type);

				instancedMeshRef.current[type.id] = new THREE.InstancedMesh(geometry, material, 1);
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

			meshesInitializedRef.current = true;
			console.log("Meshes INITIALIZED LETS GOoooo! Status: ", meshesInitializedRef.current);

			// Load terrain from IndexedDB
			DatabaseManager.getData(STORES.TERRAIN, "current")
				.then((savedTerrain) => {
					if (!mounted) return;

					if (savedTerrain) {
						terrainRef.current = savedTerrain;
						console.log("Terrain loaded from IndexedDB");
						// Move these calls inside the callback after terrain is loaded
						buildUpdateTerrain();
						totalBlocksRef.current = Object.keys(terrainRef.current).length;
					} else {
						console.log("No terrain found in IndexedDB");
						// Initialize with empty terrain
						terrainRef.current = {};
						buildUpdateTerrain();
						totalBlocksRef.current = 0;
					}

					setPageIsLoaded(true);
				})
				.catch((error) => {
					console.error("Error loading terrain:", error);
					if (mounted) {
						terrainRef.current = {};
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


