import React, { useRef, useEffect, useState, useCallback} from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';
import { soundManager } from './Sound';
import { cameraManager } from './Camera';
import { DatabaseManager, STORES } from './DatabaseManager';
import { UndoRedoManager } from './UndoRedo';

// Modify the blockTypes definition to be a function that can be updated
let blockTypesArray = (() => {
  const textureContext = require.context('../../public/assets/blocks', true, /\.(png|jpe?g)$/);
  const texturePaths = textureContext.keys();
  const blockMap = new Map();
  let idCounter = 1;

  texturePaths.forEach(path => {
    // Skip environment and error textures
    if (path.includes('environment') || path.includes('error')) {
      return;
    }

    const match = path.match(/^\.\/(.+?)(\/[+-][xyz])?\.png$/);
    if (match) {
      const [, fullName, side] = match;
      const parts = fullName.split('/');
      const blockName = parts.length > 1 ? parts[0] : fullName.replace(/\.[^/.]+$/, "");
      
      if (!blockMap.has(blockName)) {
        blockMap.set(blockName, {
          id: idCounter++,
          name: blockName,
          textureUri: `./assets/blocks/${blockName}.png`,
          sides: [],
          sideTextures: {}
        });
      }

      if (side) {
        const sideKey = side.slice(1);
        blockMap.get(blockName).sides.push(sideKey);
        blockMap.get(blockName).sideTextures[sideKey] = `./assets/blocks/${blockName}${side}.png`;
      }
    }
  });

  return Array.from(blockMap.values()).map(block => ({
    ...block,
    isMultiTexture: block.sides.length > 0
  }));
})();

// Add function to update blockTypes with custom blocks
export const updateBlockTypes = (customBlocks) => {
  blockTypesArray = [
    ...blockTypesArray,
    ...customBlocks.map(block => ({
      ...block,
      isMultiTexture: false,
      // Mark blocks that use error texture as having missing textures
      hasMissingTexture: block.textureUri === './assets/blocks/error/error.png'
    }))
  ];
  return blockTypesArray;
};

// Export the blockTypes getter
export const getBlockTypes = () => blockTypesArray;

// Export the initial blockTypes for backward compatibility
export const blockTypes = blockTypesArray;

// 3. Main Component Definition
function TerrainBuilder({ 
  terrain, 
  onTerrainUpdate, 
  currentBlockType, 
  mode, 
  setDebugInfo, 
  setTotalBlocks, 
  axisLockEnabled, 
  gridSize, 
  cameraReset, 
  cameraAngle, 
  placementSize, 
  setPageIsLoaded, 
  currentDraggingBlock, 
  onHandleDropRef,
  customBlocks,
  onSceneReady,
  environmentBuilder,
  totalEnvironmentObjects,
  setUndoStates,
  setRedoStates
}) {
  // State declarations
  const [isPlacing, setIsPlacing] = useState(false);
  const [previewPosition, setPreviewPosition] = useState(null);
  const [lockedY, setLockedY] = useState(null);
  const [lockedAxis, setLockedAxis] = useState(null);
  const [blockCounts, setBlockCounts] = useState({});
  const [isInitialized, setIsInitialized] = useState(false);
  const [raycastPoint, setRaycastPoint] = useState(null);

  // Ref declarations
  const instancedMeshRefs = useRef({});
  const isFirstBlock = useRef(true);
  const lastPreviewPosition = useRef(new THREE.Vector3());
  const lastMousePlacementPositionRef = useRef(new THREE.Vector2());
  const placementStartPosition = useRef(null);
  const orbitControlsRef = useRef();
  const gridRef = useRef();
  const directionalLightRef = useRef();
  const axisLockEnabledRef = useRef(axisLockEnabled);

  // Constants
  const MOUSE_MOVE_THRESHOLD = 10;
  const AXIS_LOCK_THRESHOLD = 0.5;
  const gridPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  // Scene setup
  const { camera, scene, raycaster, mouse, gl } = useThree();

  // Add state to track initial terrain state during placement
  const placementStartState = useRef(null);

  // 4. Core Initialization & Cleanup Effects
  useEffect(() => {
    const initializeTerrain = async () => {
      // Initialize only block types, environment models are handled by EnvironmentBuilder
      for (const type of blockTypes) {
        let geometry, material;
        geometry = await createBlockGeometry(type);
        material = await createBlockMaterial(type);
        
        instancedMeshRefs.current[type.id] = new THREE.InstancedMesh(
          geometry,
          material,
          1
        );
        
        // Disable frustum culling
        instancedMeshRefs.current[type.id].frustumCulled = false;
        
        // Set rendering order to ensure proper depth sorting
        instancedMeshRefs.current[type.id].renderOrder = 1;
        
        instancedMeshRefs.current[type.id].userData.blockTypeId = type.id;
        instancedMeshRefs.current[type.id].count = 0;
        scene.add(instancedMeshRefs.current[type.id]);
      }

      // Initialize camera manager with camera and controls
      cameraManager.initialize(camera, orbitControlsRef.current);

      const loader = new THREE.CubeTextureLoader();
      loader.setPath('./assets/skyboxes/partly-cloudy/');
      const textureCube = loader.load([
        '+x.png', '-x.png',
        '+y.png', '-y.png',
        '+z.png', '-z.png'
      ]);
      scene.background = textureCube;
      setIsInitialized(true);
    };

    initializeTerrain();

    // Capture the current refs at the time the effect runs
    const currentMeshRefs = { ...instancedMeshRefs.current };

    return () => {
      Object.values(currentMeshRefs).forEach(mesh => {
        if (mesh) {
          scene.remove(mesh);
          if (mesh.geometry) mesh.geometry.dispose();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach(m => m?.dispose());
          } else if (mesh.material) {
            mesh.material.dispose();
          }
        }
      });
    };
  }, [camera, scene]);

  useEffect(() => {
    if (isInitialized) {
      try {
        const loadTerrain = async () => {
          const savedTerrain = await DatabaseManager.getData(STORES.TERRAIN, 'current');
          
          if (savedTerrain) {
            onTerrainUpdate(savedTerrain);
            console.log('Terrain loaded from IndexedDB');
          } else {
            onTerrainUpdate({});
          }
          setPageIsLoaded(true);
        };

        loadTerrain();
      } catch (error) {
        console.error('Error loading saved terrain:', error);
        onTerrainUpdate({});
        setPageIsLoaded(true);
      }
    }
  }, [isInitialized, onTerrainUpdate, setPageIsLoaded]);

  useEffect(() => {
    const newBlockCounts = {};
    const matrix = new THREE.Matrix4();

    // Reset all mesh counts
    Object.values(instancedMeshRefs.current).forEach(mesh => {
      mesh.count = 0;
    });

    // Process terrain entries
    Object.entries(terrain).forEach(([key, value]) => {
      const [x, y, z] = key.split(',').map(Number);
      // Skip environment objects - they're handled by EnvironmentBuilder
      if (value.id >= 1000) {
        return;
      }

      const instancedMesh = instancedMeshRefs.current[value.id];
      
      if (instancedMesh) {
        const index = newBlockCounts[value.id] || 0;
        
        if (index >= instancedMesh.instanceMatrix.count) {
          const newInstanceCount = Math.ceil(instancedMesh.instanceMatrix.count * 1.5) + 1;
          const newInstancedMesh = new THREE.InstancedMesh(
            instancedMesh.geometry,
            instancedMesh.material,
            Math.max(newInstanceCount, 10)
          );
          newInstancedMesh.count = instancedMesh.count;
          newInstancedMesh.instanceMatrix.set(instancedMesh.instanceMatrix.array);
          scene.remove(instancedMesh);
          scene.add(newInstancedMesh);
          instancedMeshRefs.current[value.id] = newInstancedMesh;
        }
        
        matrix.identity();
        matrix.setPosition(x, y, z);
        instancedMeshRefs.current[value.id].setMatrixAt(index, matrix);
        newBlockCounts[value.id] = index + 1;
      }
    });

    Object.entries(newBlockCounts).forEach(([id, count]) => {
      const instancedMesh = instancedMeshRefs.current[id];
      instancedMesh.count = count;
      instancedMesh.instanceMatrix.needsUpdate = true;
    });

    // Update block counts, excluding environment objects
    setBlockCounts(newBlockCounts);
  }, [terrain, scene]);

  // 5. Camera & Control Effects
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

  // 7. Core Geometry & Material Functions
  const createBlockGeometry = (blockType) => {
    if (!blockType) {
      console.error('Invalid blockType:', blockType);
      return Promise.resolve(new THREE.BoxGeometry(1, 1, 1)); // Default fallback
    }

    if (blockType.isEnvironment) {
      return new Promise((resolve) => {
        if (blockType.textureUri) {
          new THREE.TextureLoader().load(
            blockType.textureUri,
            (texture) => {
              const aspectRatio = texture.image.width / texture.image.height;
              const planeGeometry = new THREE.PlaneGeometry(aspectRatio, 1);
              const plane1 = planeGeometry.clone();
              const plane2 = planeGeometry.clone();
              plane2.rotateY(Math.PI / 2);
              resolve(mergeGeometries([plane1, plane2]));
            },
            undefined,
            (error) => {
              console.error('Error loading texture:', error);
              resolve(new THREE.BoxGeometry(1, 1, 1));
            }
          );
        } else {
          resolve(new THREE.BoxGeometry(1, 1, 1));
        }
      });
    }
    
    return Promise.resolve(new THREE.BoxGeometry(1, 1, 1));
  };
  
  const createBlockMaterial = async (blockType) => {
    if (blockType.isCustom) {
      return new Promise((resolve) => {
        const texture = new THREE.TextureLoader().load(
          blockType.textureUri,
          undefined,
          undefined,
          () => {
            const errorTexture = new THREE.TextureLoader().load('./assets/blocks/error/error.png');
            errorTexture.magFilter = THREE.NearestFilter;
            errorTexture.minFilter = THREE.NearestFilter;
            errorTexture.colorSpace = THREE.SRGBColorSpace;
            const errorMaterial = new THREE.MeshPhongMaterial({ 
              map: errorTexture,
              depthWrite: true,
              depthTest: true,
              transparent: true,
              alphaTest: 0.5
            });
            resolve(Array(6).fill(errorMaterial));
          }
        );
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;
        
        const material = new THREE.MeshPhongMaterial({ 
          map: texture,
          depthWrite: true,
          depthTest: true,
          transparent: true,
          alphaTest: 0.5
        });
        resolve(Array(6).fill(material));
      });
    }
    
    const sides = ['+x', '-x', '+y', '-y', '+z', '-z'];
    const materials = [];

    for (const side of sides) {
      const sideTexture = `./assets/blocks/${blockType.name}/${side}.png`;
      const fallbackTexture = `./assets/blocks/${blockType.name}.png`;
      
      let texture;
      
      try {
        const loadTexture = (path) => {
          return new Promise((resolve, reject) => {
            new THREE.TextureLoader().load(
              path,
              (tex) => resolve(tex),
              undefined,
              () => reject(new Error(`Failed to load texture: ${path}`))
            );
          });
        };

        if (blockType.isMultiTexture && blockType.sides.includes(side)) {
          texture = await loadTexture(sideTexture);
        } else {
          texture = await loadTexture(fallbackTexture);
          if (blockType.isMultiTexture) {
            console.warn(`Missing side texture for ${blockType.name}, using single texture for all faces`);
            const material = new THREE.MeshPhongMaterial({ 
              map: texture,
              color: 0xffffff,
              transparent: true,
              alphaTest: 0.5,
              opacity: texture.name?.includes('water') ? 0.5 : 1
            });
            return Array(6).fill(material);
          }
        }

        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.colorSpace = THREE.SRGBColorSpace;

        materials.push(new THREE.MeshPhongMaterial({ 
          map: texture,
          color: 0xffffff,
          transparent: true,
          alphaTest: 0.5,
          opacity: texture.name?.includes('water') ? 0.5 : 1,
          depthWrite: true,
          depthTest: true
        }));
      } catch (error) {
        console.error(`Error loading texture for ${blockType.name}:`, error);
        // Load error texture instead
        const errorTexture = new THREE.TextureLoader().load('./assets/blocks/error/error.png');
        errorTexture.magFilter = THREE.NearestFilter;
        errorTexture.minFilter = THREE.NearestFilter;
        errorTexture.colorSpace = THREE.SRGBColorSpace;
        
        const errorMaterial = new THREE.MeshPhongMaterial({ 
          map: errorTexture,
          color: 0xffffff
        });
        return Array(6).fill(errorMaterial);
      }
    }

    return materials;
  };

  // Modify placeBlock to use UndoRedoManager without any trimming
  const placeBlock = async (gridX, gridY, gridZ) => {
    if (mode === 'add') {
        onTerrainUpdate((prev) => {
            const newTerrain = { ...prev };
            const added = {};
            const positions = getPlacementPositions({ x: gridX, y: gridY, z: gridZ }, placementSize);
            
            positions.forEach(pos => {
                const key = `${pos.x},${pos.y},${pos.z}`;
                if (!prev[key] || prev[key].id !== currentBlockType.id) {
                    const newBlock = { ...currentBlockType, mesh: null };
                    newTerrain[key] = newBlock;
                    added[key] = newBlock;
                }
            });
            
            return newTerrain;
        });
    } else if (mode === 'remove') {
        onTerrainUpdate((prev) => {
            const newTerrain = { ...prev };
            const removed = {};
            const positions = getPlacementPositions({ x: gridX, y: gridY, z: gridZ }, placementSize);
            
            positions.forEach(pos => {
                const key = `${pos.x},${pos.y},${pos.z}`;
                if (prev[key]) {
                    removed[key] = prev[key];
                    delete newTerrain[key];
                }
            });
            
            setTotalBlocks(Object.keys(newTerrain).length);
            return newTerrain;
        });
    }
  };

  // Update handleMouseUp to focus on axis lock only
  const handleMouseUp = useCallback(() => {
    axisLockEnabledRef.current = false;
  }, []);

  /// raycast to update preview position
  useFrame(() => {
    updatePreviewPosition();
  });

  // Helper functions
  const getRaycastIntersection = (raycaster, instancedMeshRefs, mode) => {
    const intersects = raycaster.intersectObjects(Object.values(instancedMeshRefs.current));
    if (!intersects.length) return null;

    const matrix = new THREE.Matrix4();
    intersects[0].object.getMatrixAt(intersects[0].instanceId, matrix);

    return {
        point: intersects[0].point,
        normal: intersects[0].face.normal,
    };
  };

  const getGridIntersection = (raycaster, gridPlane) => {
    // Get camera direction for debugging
    const cameraDirection = new THREE.Vector3();
    camera.getWorldDirection(cameraDirection);
    
    // Create a plane that's aligned with the world grid and offset by -0.5 to match grid helper
    const tempPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.5); // Changed constant to 0.5
    const planeIntersection = new THREE.Vector3();
    
    if (!raycaster.ray.intersectPlane(tempPlane, planeIntersection)) return null;
    
    return {
        point: planeIntersection,
        normal: new THREE.Vector3(0, 1, 0)
    };
  };

  const calculateGridPosition = (intersection, mode, currentBlockType, faceNormal) => {
    if (!intersection) return null;
    
    let position;
      // For add mode, offset slightly from the face
      position = intersection.point.clone().add(faceNormal.multiplyScalar(0.01));
      
      if (mode === 'remove') {
          console.log('remove mode. Face normal: ', faceNormal);
          position.x = Math.round(position.x - faceNormal.x * 5);
          position.y = Math.round(position.y - faceNormal.y * 5);
          position.z = Math.round(position.z - faceNormal.z * 5);
      }
      else if (!currentBlockType?.isEnvironment) {
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

  function updatePreviewPosition() {
    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();
    
    // Calculate normalized device coordinates (NDC) using clientX/Y
    const normalizedMouse = {
        x: (((mouse.x + 1) / 2 * rect.width) - rect.width/2) / rect.width * 2,
        y: (((mouse.y + 1) / 2 * rect.height) - rect.height/2) / rect.height * 2
    };

    raycaster.setFromCamera(normalizedMouse, camera);
    
    // Get intersection point (either with existing blocks or grid)
    const intersection = getRaycastIntersection(raycaster, instancedMeshRefs, mode) || 
                        getGridIntersection(raycaster, gridPlane);

    /// if no intersection, set debug info and return
    if (!intersection) {
      setDebugInfo({ mouse: { x: mouse.x.toFixed(2), y: mouse.y.toFixed(2) }, grid: {}, preview: {} });
      return;
    }

    // Calculate grid position
    let gridPosition = calculateGridPosition(intersection, mode, currentBlockType, intersection.normal);
    if (!gridPosition) return;

    // Apply constraints
    if (Object.keys(terrain).length === 0 || intersection.normal.equals(new THREE.Vector3(0, 1, 0))) {
      gridPosition.y = 0;
    }
    if (lockedY !== null) {
      gridPosition.y = lockedY;
    }
    if (axisLockEnabled && isPlacing && lockedAxis && placementStartPosition.current) {
      gridPosition = applyAxisLock(gridPosition, placementStartPosition.current, lockedAxis);
    }

    // Update environment preview if needed
    if (currentBlockType?.isEnvironment && environmentBuilder.current) {
      environmentBuilder.current.updateModelPreview(gridPosition);
    }

    // Handle continuous block placement
    const mouseMovementDistance = new THREE.Vector2(
      mouse.x - lastMousePlacementPositionRef.current.x,
      mouse.y - lastMousePlacementPositionRef.current.y
    ).length() * window.innerWidth/2;

    if (isPlacing && mouseMovementDistance >= MOUSE_MOVE_THRESHOLD) {
        placeBlock(gridPosition.x, gridPosition.y, gridPosition.z);
        lastMousePlacementPositionRef.current.copy(mouse);

        // Update preview position, but only if the mouse moved
        setPreviewPosition(gridPosition);
    }
    else if(!isPlacing){
        setPreviewPosition(gridPosition);
    }

    // Handle axis locking
    if (axisLockEnabled && !lockedAxis && placementStartPosition.current) {
      const diff = new THREE.Vector3().subVectors(gridPosition, placementStartPosition.current);
      if (diff.length() > AXIS_LOCK_THRESHOLD) {
        const [absX, absY, absZ] = [Math.abs(diff.x), Math.abs(diff.y), Math.abs(diff.z)];
        const maxDiff = Math.max(absX, absY, absZ);
        setLockedAxis(maxDiff === absX ? 'x' : maxDiff === absY ? 'y' : 'z');
      }
    }

    /// save preview position
    lastPreviewPosition.current.set(
      Math.round(gridPosition.x * 10) / 10,
      Math.round(gridPosition.y * 10) / 10, 
      Math.round(gridPosition.z * 10) / 10
    );

    // Update debug info
    setDebugInfo({
      mouse: { x: mouse.x.toFixed(2), y: mouse.y.toFixed(2) },
      grid: { x: gridPosition.x, y: gridPosition.y, z: gridPosition.z },
      preview: lastPreviewPosition.current,
      lockedAxis: axisLockEnabled ? lockedAxis : 'None',
      totalEnvironmentObjects: totalEnvironmentObjects,
    });
  }

  // Modify handlePointerDown to capture initial state
  const handlePointerDown = async (event) => {
    if (event.button === 0) {
        setIsPlacing(true);
        soundManager.playPlaceSound();
        
        // Capture initial state when placement starts
        const currentEnvironment = await DatabaseManager.getData(STORES.ENVIRONMENT, 'current') || [];
        placementStartState.current = { 
          terrain: { ...terrain },
          environment: currentEnvironment
        };
        
        if (previewPosition) {
            setLockedY(previewPosition.y);
            
            if (currentBlockType?.isEnvironment && isFirstBlock.current) {
                lastMousePlacementPositionRef.current.copy(mouse);
                environmentBuilder.current.placeEnvironmentModel();
            } else if (isFirstBlock.current){
                lastMousePlacementPositionRef.current.copy(mouse);
                placeBlock(previewPosition.x, previewPosition.y, previewPosition.z);
            }
            
            isFirstBlock.current = false;
        }
    }
  };

  // Move undo state saving to handlePointerUp
  const handlePointerUp = async (event) => {
    if (event.button === 0) {
        setIsPlacing(false);
        setLockedY(null);
        isFirstBlock.current = true;
        
        // Save state to undo stack only if we made changes
        if (placementStartState.current) {
            const currentState = {
                terrain: { ...terrain },
                environment: await DatabaseManager.getData(STORES.ENVIRONMENT, 'current') || []
            };
            
            // Calculate changes
            const changes = {
                terrain: {
                    added: {},
                    removed: {}
                },
                environment: {
                    added: [],
                    removed: []
                }
            };
            
            // Calculate terrain changes
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
            
            // Save changes to UndoRedoManager if there were any changes
            if (Object.keys(changes.terrain.added).length > 0 || 
                Object.keys(changes.terrain.removed).length > 0) {
                await UndoRedoManager.saveUndo(changes);
            }
            
            placementStartState.current = null;
        }

        if (axisLockEnabled) {
            setLockedAxis(null);
            placementStartPosition.current = null;
        }
    }
  };

  // Add event listener for mouseup
  useEffect(() => {
    if (isInitialized) {
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isInitialized, handleMouseUp]);

  const getPlacementPositions = (centerPos, placementSize) => {
    const positions = [];
    
    // Always include center position
    positions.push({ ...centerPos });
    
    switch (placementSize) {
      case 'single':
        break;
        
      case 'cross':
        positions.push(
          { x: centerPos.x + 1, y: centerPos.y, z: centerPos.z },
          { x: centerPos.x - 1, y: centerPos.y, z: centerPos.z },
          { x: centerPos.x, y: centerPos.y, z: centerPos.z + 1 },
          { x: centerPos.x, y: centerPos.y, z: centerPos.z - 1 }
        );
        break;
        
      case 'diamond':
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
        
      case 'square9':
        for (let x = -1; x <= 1; x++) {
          for (let z = -1; z <= 1; z++) {
            if (x !== 0 || z !== 0) {  // Skip center as it's already added
              positions.push({
                x: centerPos.x + x,
                y: centerPos.y,
                z: centerPos.z + z
              });
            }
          }
        }
        break;
        
      case 'square16':
        for (let x = -2; x <= 1; x++) {
          for (let z = -2; z <= 1; z++) {
            if (x !== 0 || z !== 0) {  // Skip center as it's already added
              positions.push({
                x: centerPos.x + x,
                y: centerPos.y,
                z: centerPos.z + z
              });
            }
          }
        }
        break;
    }
    
    return positions;
  };

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    const draggedBlockId = parseInt(currentDraggingBlock);
    
    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();
    const normalizedMouse = {
      x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((event.clientY - rect.top) / rect.height) * 2 + 1
    };
    
    raycaster.setFromCamera(normalizedMouse, camera);
    const intersects = raycaster.intersectObjects(Object.values(instancedMeshRefs.current));
    
    if (intersects.length > 0) {
      const intersection = intersects[0];
      const matrix = new THREE.Matrix4();
      intersection.object.getMatrixAt(intersection.instanceId, matrix);
      const position = new THREE.Vector3();
      position.setFromMatrixPosition(matrix);
      
      const startKey = `${Math.round(position.x)},${Math.round(position.y)},${Math.round(position.z)}`;
      const draggedBlockType = [...blockTypes, ...customBlocks].find(b => b.id === draggedBlockId);
      
      if (draggedBlockType) {
        // Save current state to undo stack before making changes
        setUndoStates(prev => [...prev, { terrain: { ...terrain } }]);
        setRedoStates([]); // Clear redo stack when new action is performed

        onTerrainUpdate(prevTerrain => {
          const targetBlock = prevTerrain[startKey];
          if (!targetBlock) return prevTerrain;
          
          const targetBlockId = parseInt(targetBlock.id);
          const newTerrain = { ...prevTerrain };
          const visited = new Set();
          const queue = [startKey];
          
          while (queue.length > 0) {
            const key = queue.shift();
            if (visited.has(key)) continue;
            
            visited.add(key);
            const block = prevTerrain[key];
            
            if (!block || parseInt(block.id) !== targetBlockId) continue;
            
            newTerrain[key] = { ...draggedBlockType };
            
            const [x, y, z] = key.split(',').map(Number);
            const adjacent = [
              `${x+1},${y},${z}`,
              `${x-1},${y},${z}`,
              `${x},${y+1},${z}`,
              `${x},${y-1},${z}`,
              `${x},${y},${z+1}`,
              `${x},${y},${z-1}`
            ];
            
            adjacent.forEach(adjKey => {
              if (prevTerrain[adjKey] && !visited.has(adjKey)) {
                queue.push(adjKey);
              }
            });
          }

          // Save to IndexedDB
          DatabaseManager.saveData(STORES.TERRAIN, 'current', newTerrain)
            .catch(e => console.warn('Failed to save terrain to IndexedDB:', e));

          return newTerrain;
        });
      }
    }
  }, [currentDraggingBlock, raycaster, camera, onTerrainUpdate, gl, customBlocks, terrain, setUndoStates, setRedoStates]);

  // Register the handleDrop function with the ref callback
  useEffect(() => {
    if (onHandleDropRef) {
      onHandleDropRef(handleDrop);
    }
  }, [handleDrop, onHandleDropRef]);

  // Add this useEffect after the other useEffects
  useEffect(() => {
    if (!gl.domElement) return;

    const canvas = gl.domElement;
    
    const handleDragOver = (e) => {
      e.preventDefault();
    };

    canvas.addEventListener('dragover', handleDragOver);
    canvas.addEventListener('drop', handleDrop);

    return () => {
      canvas.removeEventListener('dragover', handleDragOver);
      canvas.removeEventListener('drop', handleDrop);
    };
  }, [gl, handleDrop]);

  // Update the useEffect that handles custom blocks
  useEffect(() => {
    if (!isInitialized) return;

    const currentCustomBlockIds = new Set(customBlocks.map(block => block.id));

    // Clean up removed custom blocks
    Object.entries(instancedMeshRefs.current).forEach(([id, mesh]) => {
      const numericId = parseInt(id);
      if (numericId >= 500 && !currentCustomBlockIds.has(numericId)) {
        scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m?.dispose());
        } else if (mesh.material) {
          mesh.material.dispose();
        }
        delete instancedMeshRefs.current[id];
      }
    });

    // Initialize new custom blocks
    customBlocks.forEach(async (blockType) => {
      if (!instancedMeshRefs.current[blockType.id]) {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const materials = await createBlockMaterial(blockType);
        
        instancedMeshRefs.current[blockType.id] = new THREE.InstancedMesh(
          geometry,
          materials[0], // Use first material for all faces
          1
        );
        
        instancedMeshRefs.current[blockType.id].userData.blockTypeId = blockType.id;
        instancedMeshRefs.current[blockType.id].count = 0;
        scene.add(instancedMeshRefs.current[blockType.id]);
      }
    });
  }, [customBlocks, scene, isInitialized]);

  useEffect(() => {
    if (scene && onSceneReady) {
      onSceneReady(scene);
    }
  }, [scene, onSceneReady]);

  return (
    <>
      <OrbitControls 
        ref={orbitControlsRef}
        enablePan={true}
        enableZoom={false}
        enableRotate={true}
        mouseButtons={{
          MIDDLE: THREE.MOUSE.PAN,
          RIGHT: THREE.MOUSE.ROTATE
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

      <ambientLight intensity={0.8} />

      <gridHelper 
        ref={gridRef}
        args={[gridSize, gridSize, 0x5c5c5c, 0xeafaea]} 
        position={[0.5, -0.5, 0.5]}
        transparent={true}
        opacity={0.5}
      >
      </gridHelper>

      <mesh 
        position={[0, -0.5, 0]} 
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => setIsPlacing(false)}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onDragEnter={(e) => e.preventDefault()}
        visible={true}
        receiveShadow={true}
        castShadow={true}
      >
        <planeGeometry args={[gridSize, gridSize]} />
        <meshPhongMaterial transparent opacity={0} />
      </mesh>

      {Object.entries(blockCounts).map(([id]) => (
        <primitive 
          key={id} 
          object={instancedMeshRefs.current[id]} 
          castShadow 
          receiveShadow
        />
      ))}

      {previewPosition && (mode === 'add' || mode === 'remove') && (
        <>
          {getPlacementPositions(previewPosition, placementSize).map((pos, index) => (
            <group key={index} position={[pos.x, pos.y, pos.z]}>
              <mesh renderOrder={2}>
                <boxGeometry args={[1.02, 1.02, 1.02]} />
                <meshPhongMaterial 
                  color={mode === 'add' ? "green" : "red"} 
                  opacity={0.4}
                  transparent={true}
                  depthWrite={false}
                  depthTest={true}
                  alphaTest={0.1}
                />
              </mesh>
              <lineSegments renderOrder={3}>
                <edgesGeometry args={[new THREE.BoxGeometry(1, 1, 1)]} />
                <lineBasicMaterial color="darkgreen" linewidth={2} />
              </lineSegments>
            </group>
          ))}
        </>
      )}

      {/* Shadow plane underneath the grid*/}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]} receiveShadow>
        <planeGeometry args={[gridSize, gridSize]} />
        <shadowMaterial transparent opacity={0.2} />
      </mesh>

      {/* Debug visualization of raycast intersection */}
      {raycastPoint && (
        <mesh position={raycastPoint}>
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshBasicMaterial color="red" />
        </mesh>
      )}

    </>
  );
}

export default TerrainBuilder;


