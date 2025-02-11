import React, { useRef, useEffect, useState } from "react";
import { useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils";
import { playPlaceSound } from "./Sound";
import { cameraManager } from "./Camera";
import { DatabaseManager, STORES } from "./DatabaseManager";
import { UndoRedoManager } from "./UndoRedo";

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

function TerrainBuilder({ setAppJSTerrainState, currentBlockType, mode, setDebugInfo, axisLockEnabled, gridSize, cameraReset, cameraAngle, placementSize, setPageIsLoaded, customBlocks, environmentBuilderRef }) {

	// Constants
	const AXIS_LOCK_THRESHOLD = 0.5;
	const THRESHOLD_FOR_PLACING = 10;

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

	// state for preview position to force re-render of preview cube when it changes
	const [previewPosition, setPreviewPosition] = useState(new THREE.Vector3());

	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//
	//* TERRAIN UPDATE FUNCTIONS *//

	/// define buildUpdateTerrain to update the terrain
	const buildUpdateTerrain = () => {


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

		// send terrain state to app.js so other components can use it
		setAppJSTerrainState(terrainRef.current);

		console.log("finishedbuilding update terrain");

		// Update block counts
		blockCountsRef.current = blockCountsByType;
		totalBlocksRef.current = Object.keys(terrainRef.current).length;
		
		// Only update UI when needed (could be on a timer or specific events)
		setDebugInfo({
			preview: previewPositionRef.current,
			lockedAxis: axisLockEnabled ? lockedAxisRef.current : "None",
			totalBlocks: totalBlocksRef.current,
		});
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
			console.log("Mouse Down");
			isPlacingRef.current = true;
			currentPlacingYRef.current = previewPositionRef.current.y;

			// Handle initial placement
			updatePreviewPosition();
			playPlaceSound();
		}
	};

	const handleBlockPlacement = () => {
		if (!mode || !isPlacingRef.current) return;

		console.log("handling block placement: called");

		// Handle environment models separately
		if (currentBlockTypeRef.current?.isEnvironment) {
			environmentBuilderRef.placeEnvironmentModel();
			console.log("handling block placement: environment model placed");
			return;
		}

		const newPlacementPosition = previewPositionRef.current.clone();

		// Get all positions to place/remove blocks
		const positions = getPlacementPositions(newPlacementPosition, placementSize);
		let terrainChanged = false;

		positions.forEach((pos) => {
			const key = `${pos.x},${pos.y},${pos.z}`;

			if (mode === "add") {
				// Only place if there isn't already a block here
				if (!terrainRef.current[key]) {
					terrainRef.current[key] = { ...currentBlockTypeRef.current };
					terrainChanged = true;
					console.log("handling block placement: adding block");
				}
			} else if (mode === "remove") {
				if (terrainRef.current[key]) {
					delete terrainRef.current[key];
					terrainChanged = true;
				}
			}
		});

		if (terrainChanged) {
			console.log("handling block placement: terrain changed");
			buildUpdateTerrain();
			totalBlocksRef.current = Object.keys(terrainRef.current).length;
		}
	};

	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///
	/// Raycast and Grid Intersection Functions ///

	const getRaycastIntersection = (raycastOrigin) => {
		const raycastIntersects = raycastOrigin.intersectObjects(scene.children);
		if (!raycastIntersects.length) return null;

		let rayHitBlock = null;
		let rayHitShadowPlane = null;

		for (const intersect of raycastIntersects) {
			if (intersect.object.isInstancedMesh) {
				rayHitBlock = intersect;
				break;
			}
			if (intersect.object === shadowPlaneRef.current) {
				rayHitShadowPlane = intersect;
			}
		}

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
		/// get canvas to get mouse position with respect to the canvas
		const canvas = gl.domElement;
		const rect = canvas.getBoundingClientRect();

		/// normalize mouse position to the canvas
		const normalizedMouse = {
			x: ((((mouse.x + 1) / 2) * rect.width - rect.width / 2) / rect.width) * 2,
			y: ((((mouse.y + 1) / 2) * rect.height - rect.height / 2) / rect.height) * 2,
		};

		/// set raycaster to the normalized mouse position and camera
		raycaster.setFromCamera(normalizedMouse, camera);
		const intersection = getRaycastIntersection(raycaster);

		/// if no intersection, set preview position to 0,0,0
		if (!intersection) {
			previewPositionRef.current = new THREE.Vector3(0, 0, 0);
			return;
		}

		if (!currentBlockTypeRef?.current?.isEnvironment) {
			/// calculate grid position based on intersection, mode, and intersection normal
			let gridPosition = calculateGridPosition(intersection, mode, intersection.normal);
			if (axisLockEnabled && lockedAxisRef.current && placementStartPosition.current) {
				gridPosition = applyAxisLock(gridPosition, placementStartPosition.current, lockedAxisRef.current);
			}

			/// if mouse is down, set grid position y to current placing y
			if (isPlacingRef.current) {
				gridPosition.y = currentPlacingYRef.current;
			}
			/// set preview position to grid position
			previewPositionRef.current = gridPosition;
			setPreviewPosition(gridPosition);
		} else {
			/// set preview position to intersection point
			previewPositionRef.current = intersection.point;
			setPreviewPosition(intersection.point);
		}

		/// Instead of forcing re-render with setPreviewUpdate,
		// directly update the preview mesh if needed
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

			if (placementStartState.current) {
				const currentState = {
					terrain: { ...terrainRef.current },
					environment: DatabaseManager.getData(STORES.ENVIRONMENT, "current") || [],
				};

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

				if (Object.keys(changes.terrain.added).length > 0 || Object.keys(changes.terrain.removed).length > 0) {
					UndoRedoManager.saveUndo(changes);
				}

				placementStartState.current = null;
			}

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

	// Update grid size
	const updateGridSize = (newGridSize) => {
		if (gridRef.current) {
			// Get grid size from localStorage or use default value
			const savedGridSize = parseInt(localStorage.getItem("gridSize"), 10) || newGridSize;
			console.log("Updating grid size from value:", newGridSize, "to value:", savedGridSize);

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

	// Initialize instanced meshes
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
					} else {
						console.log("No terrain found in IndexedDB");
					}

					setPageIsLoaded(true);
				})
				.catch((error) => {
					console.error("Error loading terrain:", error);
					if (mounted) {
						setPageIsLoaded(true);
					}
				});

			buildUpdateTerrain();
			totalBlocksRef.current = Object.keys(terrainRef.current).length;
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

			{previewPosition && (mode === "add" || mode === "remove") && (
				<group>
					{getPlacementPositions(previewPosition, placementSize).map((pos, index) => (
						<group
							key={index}
							position={[pos.x, pos.y, pos.z]}>
							<mesh renderOrder={2}>
								<boxGeometry args={[1.02, 1.02, 1.02]} />
								<meshPhongMaterial
									color={mode === "add" ? "green" : "red"}
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

export default TerrainBuilder;
