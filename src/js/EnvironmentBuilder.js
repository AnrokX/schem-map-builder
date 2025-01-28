import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';
import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { DatabaseManager, STORES } from './DatabaseManager';
import { MAX_UNDO_STATES } from './Constants';

export const environmentModels = (() => {
  try {
    // Function to fetch directory listing from the server synchronously
    const fetchModelList = () => {
      const manifestUrl = `${process.env.PUBLIC_URL}/assets/models/environment/mattifest.json`;
      const xhr = new XMLHttpRequest();
      xhr.open('GET', manifestUrl, false); // false makes it synchronous
      xhr.send();
      
      if (xhr.status !== 200) {
        throw new Error('Failed to load model mattifest');
      }
      
      return JSON.parse(xhr.responseText);
    };

    let idCounter = 1000;
    const models = new Map();
    const result = [];

    // Load models synchronously
    const modelList = fetchModelList();
    modelList.forEach(fileName => {
      const name = fileName.replace('.gltf', '');
      const model = {
        id: idCounter++,
        name: name,
        modelUrl: `assets/models/environment/${fileName}`,
        isEnvironment: true,
        animations: ['idle']
      };
      models.set(name, model);
      result.push(model);
    });

    console.log('Final environment models:', result);
    return result;

  } catch (error) {
    console.error('Error loading environment models:', error);
    return [];
  }
})();

export const EnvironmentBuilder = forwardRef(({ 
  scene, 
  currentBlockType, 
  mode, 
  previewScale, 
  previewRotation,
  onTotalObjectsChange,
  placementSize = 'single',
  placementSettings = {
    randomSize: false,
    randomRotation: false,
    minSize: 0.5,
    maxSize: 1.5,
    minRotation: 0,
    maxRotation: 360,
    size: 1.0,
    rotation: 0,
  }
}, ref) => {
    // Convert class properties to refs and state
    const loader = useRef(new GLTFLoader());
    const [placeholderMesh, setPlaceholderMesh] = useState(null);
    const loadedModels = useRef(new Map());
    const instancedMeshes = useRef(new Map());
    const positionOffset = useRef(new THREE.Vector3(0, -0.5, 0));
    const [totalEnvironmentObjects, setTotalEnvironmentObjects] = useState(0);

    // Convert class methods to functions
    const loadModel = async (modelToLoadUrl) => {
        if (!modelToLoadUrl) {
            console.warn('No model URL provided');
            return null;
        }

        // Check if already loaded
        if (loadedModels.current.has(modelToLoadUrl)) {
            return loadedModels.current.get(modelToLoadUrl);
        }

        // Properly construct the URL based on the input
        let fullUrl;
        if (modelToLoadUrl.startsWith('blob:')) {
            fullUrl = modelToLoadUrl;
        } else if (modelToLoadUrl.startsWith('http')) {
            fullUrl = modelToLoadUrl;
        } else {
            // Remove any leading slashes and ensure proper path construction
            const cleanPath = modelToLoadUrl.replace(/^\/+/, '');
            fullUrl = `${process.env.PUBLIC_URL}/${cleanPath}`;
        }

        return new Promise((resolve, reject) => {
            loader.current.load(
                fullUrl,
                (gltf) => {
                    loadedModels.current.set(modelToLoadUrl, gltf);
                    resolve(gltf);
                },
                (progress) => {
                    //console.log(`Loading ${fullUrl}: ${(progress.loaded / progress.total * 100)}%`);
                },
                (error) => {
                    console.error('Error loading model:', fullUrl, error);
                    reject(error);
                }
            );
        });
    };

    const getObjectByPosition = (position) => {
        // Find the object in the scene that matches the position
        return scene.children.find(child => 
          child.position.x === position.x &&
          child.position.y === position.y &&
          child.position.z === position.z
        );
      }

    const loadCustomModelsFromDB = async () => {
        try {
            const customModels = await DatabaseManager.getData(STORES.CUSTOM_MODELS, 'models');
            if (!customModels) return;
            
            for (const model of customModels) {
                const blob = new Blob([model.data], { type: 'model/gltf+json' });
                const fileUrl = URL.createObjectURL(blob);
                
                const newEnvironmentModel = {
                    id: Math.max(...environmentModels.map(model => model.id), 199) + 1,
                    name: model.name,
                    modelUrl: fileUrl,
                    isEnvironment: true,
                    isCustom: true,
                    animations: ['idle']
                };
                
                environmentModels.push(newEnvironmentModel);
            }
        } catch (error) {
            console.error('Error loading custom models from DB:', error);
        }
    };

    const preloadModels = async () => {
        console.log('Starting model preload sequence...');
        
        // First load custom models
        await loadCustomModelsFromDB();
        console.log('Custom models loaded from DB');
        
        // Then load and setup all models (both default and custom)
        const loadPromises = environmentModels.map(async model => {
            try {
                const gltf = await loadModel(model.modelUrl);
                await setupInstancedMesh(model, gltf);
                console.log(`Model loaded and setup: ${model.name}`);
            } catch (error) {
                console.error(`Error preloading model ${model.name}:`, error);
            }
        });
        
        // Wait for all models to be loaded and set up
        await Promise.all(loadPromises);
        console.log('All models loaded and setup complete');

        // Finally, load saved environment data
        await loadSavedEnvironment();
        console.log('Environment data loaded');
    };
    
    // Update the setTotalEnvironmentObjects usage
    useEffect(() => {
        onTotalObjectsChange?.(totalEnvironmentObjects);
    }, [totalEnvironmentObjects, onTotalObjectsChange]);

    // Add initialization in useEffect
    useEffect(() => {
        if (scene) {
            preloadModels().catch(error => {
                console.error('Error during model preload:', error);
            });
        }
    }, [scene]); // Only run when scene is available

    const setupInstancedMesh = async (modelType, gltf) => {
        if (!gltf || !gltf.scene) {
            console.error('Invalid GLTF data for model:', modelType.name);
            return;
        }

        // Calculate bounding box for the entire model
        const bbox = new THREE.Box3().setFromObject(gltf.scene);
        const size = bbox.getSize(new THREE.Vector3());
        const boundingHeight = size.y;

        // Add boundingBoxHeight to the model type in environmentModels
        const modelIndex = environmentModels.findIndex(model => model.id === modelType.id);
        if (modelIndex !== -1) {
            environmentModels[modelIndex] = {
                ...environmentModels[modelIndex],
                boundingBoxHeight: boundingHeight
            };
        }

        // Group geometries by material
        const geometriesByMaterial = new Map();
        
        gltf.scene.traverse((child) => {
            if (child.isMesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                
                materials.forEach((material, materialIndex) => {
                    // Clone and modify the material for proper rendering
                    const newMaterial = material.clone();
                    newMaterial.depthWrite = true;
                    newMaterial.depthTest = true;
                    newMaterial.transparent = true;
                    newMaterial.alphaTest = 0.5;
                    
                    if (!geometriesByMaterial.has(newMaterial)) {
                        geometriesByMaterial.set(newMaterial, []);
                    }
                    
                    // Clone geometry and apply world transform
                    const geometry = child.geometry.clone();
                    geometry.applyMatrix4(child.matrixWorld);
                    
                    if (Array.isArray(child.material)) {
                        
                        // Create a new geometry containing only the faces for this material
                        const filteredGeometry = geometry.clone();
                        const index = geometry.index.array;
                        const newIndices = [];
                        
                        // Keep only the faces that use this material
                        for (let i = 0; i < index.length; i += 3) {
                            if (geometry.groups.length > 0) {
                                // Find which group (material) this face belongs to
                                const faceIndex = i / 3;
                                const group = geometry.groups.find(g => 
                                    faceIndex >= g.start / 3 && 
                                    faceIndex < (g.start + g.count) / 3
                                );
                                
                                if (group && group.materialIndex === materialIndex) {
                                    newIndices.push(index[i], index[i + 1], index[i + 2]);
                                }
                            }
                        }
                        
                        if (newIndices.length > 0) {
                            filteredGeometry.setIndex(newIndices);
                            geometriesByMaterial.get(newMaterial).push(filteredGeometry);
                        }
                    } else {
                        geometriesByMaterial.get(newMaterial).push(geometry);
                    }
                });
            }
        });

        // Create instanced meshes
        const instancedMeshArray = [];
        for (const [material, geometries] of geometriesByMaterial.entries()) {
            if (geometries.length > 0) {
                const mergedGeometry = mergeGeometries(geometries);
                const instancedMesh = new THREE.InstancedMesh(
                    mergedGeometry,
                    material,
                    10 // Initial capacity
                );
                
                // Disable frustum culling
                instancedMesh.frustumCulled = false;
                
                // Set rendering order
                instancedMesh.renderOrder = 1;
                
                instancedMesh.count = 0;
                scene.add(instancedMesh);
                instancedMeshArray.push(instancedMesh);
            }
        }

        // Store all instanced meshes for this model in the ref
        instancedMeshes.current.set(modelType.modelUrl, {
            meshes: instancedMeshArray,
            instances: new Map(),
            modelHeight: boundingHeight
        });
    };

    const updateModelPreview = async (position) => {
        if (!currentBlockType || !scene) {
            return;
        }

        if(!currentBlockType.isEnvironment && placeholderMesh)
        {
            removePreview();
            return;
        }

        try {
            // Compare with currentBlockType.id instead of currentBlockType
            const modelData = environmentModels.find(model => model.id === currentBlockType.id);
            if (!modelData) {
                console.warn('Model data not found for type:', currentBlockType);
                return;
            }

            // If we don't have a placeholder mesh or it's for a different model, create a new one
            if (!placeholderMesh || placeholderMesh.userData.modelId !== currentBlockType.id) {
                // Remove existing preview since model changed
                removePreview();

                // Load the new model if not already loaded
                const gltf = await loadModel(modelData.modelUrl);
                if (!gltf) {
                    console.warn('Failed to load model for preview');
                    return;
                }

                // Create and setup preview mesh
                setupPreview(position);
            } else {
                // Just update the position of the existing preview mesh
                placeholderMesh.position.copy(position?.clone().add(positionOffset.current) || new THREE.Vector3());
            }
        } catch (error) {
            console.error('Error updating model preview:', error);
        }
    };

    const setupPreview = (position) => {
        // Compare with currentBlockType.id instead of currentBlockType
        const modelData = environmentModels.find(model => model.id === currentBlockType.id);
        if (!modelData) {
            console.warn('Model data not found for type:', currentBlockType);
            return;
        }

        ///console.log("Setting up preview for model:", modelData.name);
        
        // Get the loaded GLTF model
        const gltf = loadedModels.current.get(modelData.modelUrl);
        if (!gltf) {
            console.warn('GLTF model not loaded for preview');
            return;
        }

        // Clone the model for preview
        const previewModel = gltf.scene.clone();
        previewModel.userData.modelId = currentBlockType.id;
        
        // Apply transformations
        previewModel.scale.set(1, 1, 1);
        previewModel.position.copy(position?.clone().add(positionOffset.current) || new THREE.Vector3());
        previewModel.rotation.copy(new THREE.Euler());
        
        // Make the preview semi-transparent and ensure proper rendering
        previewModel.traverse((child) => {
            if (child.isMesh) {
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.depthWrite = true;
                child.material.depthTest = true;
                child.material.alphaTest = 0.5;
                child.renderOrder = 2; // Higher render order for preview
                child.frustumCulled = false;
            }
        });
        
        // Add to scene and update state
        scene.add(previewModel);
        setPlaceholderMesh(previewModel);
    };

    const loadSavedEnvironment = async () => {
        try {
            const savedEnvironment = await DatabaseManager.getData(STORES.ENVIRONMENT, 'current');
            console.log('Retrieved environment data:', savedEnvironment);
            
            if (Array.isArray(savedEnvironment) && savedEnvironment.length > 0) {
                await updateEnvironmentToMatch(savedEnvironment);
                console.log('Updated environment state');
            } else {
                console.log('No saved environment data found, clearing');
                await clearEnvironments();
            }
        } catch (error) {
            console.error('Error loading saved environment:', error);
        }
    };

    // New function to efficiently update environment
    const updateEnvironmentToMatch = async (targetState) => {
        try {
            // Create maps for quick lookups
            const targetStateMap = new Map(
                targetState.map(obj => [
                    `${obj.modelUrl}-${obj.position.x}-${obj.position.y}-${obj.position.z}`,
                    obj
                ])
            );

            const currentStateMap = new Map();
            
            // Build current state map
            for (const [modelUrl, instancedData] of instancedMeshes.current) {
                instancedData.instances.forEach((data, instanceId) => {
                    const key = `${modelUrl}-${data.position.x}-${data.position.y}-${data.position.z}`;
                    currentStateMap.set(key, { modelUrl, instanceId, ...data });
                });
            }

            const toRemove = [];
            const toAdd = [];

            // Find objects to remove/add
            for (const [key, currentObj] of currentStateMap) {
                if (!targetStateMap.has(key)) {
                    toRemove.push(currentObj);
                }
            }

            for (const [key, targetObj] of targetStateMap) {
                if (!currentStateMap.has(key)) {
                    toAdd.push(targetObj);
                }
            }

            // Remove objects that shouldn't be there
            for (const obj of toRemove) {
                const instancedData = instancedMeshes.current.get(obj.modelUrl);
                if (instancedData) {
                    removeInstance(obj.modelUrl, obj.instanceId);
                }
            }

            // Add new objects without saving state each time
            for (const obj of toAdd) {
                const modelType = environmentModels.find(model => model.modelUrl === obj.modelUrl);
                if (modelType) {
                    const tempMesh = new THREE.Object3D();
                    tempMesh.position.copy(obj.position);
                    tempMesh.rotation.copy(obj.rotation);
                    tempMesh.scale.copy(obj.scale);
                    
                    // Use a version of placeEnvironmentModel that doesn't save state
                    await placeEnvironmentModelWithoutSaving({ ...modelType, isEnvironment: true }, tempMesh);
                }
            }

            // Save state once at the end
            if (toAdd.length > 0 || toRemove.length > 0) {
                await updateLocalStorage();
            }

            // Update total count
            setTotalEnvironmentObjects(targetState.length);

        } catch (error) {
            console.error('Error updating environment:', error);
        }
    };

    // New function that places without saving state
    const placeEnvironmentModelWithoutSaving = async (blockType, mesh) => {
        try {
            if (!blockType || !mesh) return null;

            const modelData = environmentModels.find(model => model.id === blockType.id);
            if (!modelData) return null;

            const modelUrl = modelData.modelUrl;
            const instancedData = instancedMeshes.current.get(modelUrl);
            
            if (!instancedData) return null;

            const position = mesh.position.clone();
            const rotation = mesh.rotation.clone();
            const scale = mesh.scale.clone();

            const matrix = new THREE.Matrix4();
            matrix.compose(position, new THREE.Quaternion().setFromEuler(rotation), scale);

            const instanceId = instancedData.instances.size;
            
            instancedData.meshes.forEach(mesh => {
                mesh.count++;
                if (instanceId >= mesh.instanceMatrix.count) {
                    expandInstancedMeshCapacity(modelUrl);
                }
                mesh.setMatrixAt(instanceId, matrix);
                mesh.instanceMatrix.needsUpdate = true;
            });

            instancedData.instances.set(instanceId, {
                position,
                rotation,
                scale,
                matrix
            });

            return {
                modelUrl,
                instanceId,
                position,
                rotation,
                scale
            };
        } catch (error) {
            console.error('Error in placeEnvironmentModelWithoutSaving:', error);
            return null;
        }
    };

    const clearEnvironments = () => {
        ///console.log("Clearing environments");

        // Clear all instances but keep mesh setup
        for (const instancedData of instancedMeshes.current.values()) {
            // Reset count on all meshes to 0
            instancedData.meshes.forEach(mesh => {
                mesh.count = 0;
                mesh.instanceMatrix.needsUpdate = true;
            });
            
            // Clear all instances from the Map
            instancedData.instances.clear();
        }

        updateLocalStorage();
    };

    const getRandomValue = (min, max) => {
        return Math.random() * (max - min) + min;
    };

    const getPlacementTransform = () => {
        const scale = placementSettings.randomSize
            ? getRandomValue(placementSettings.minSize, placementSettings.maxSize)
            : placementSettings.size;
        
        const rotation = placementSettings.randomRotation
            ? getRandomValue(placementSettings.minRotation, placementSettings.maxRotation)
            : placementSettings.rotation;

        return {
            scale: new THREE.Vector3(scale, scale, scale),
            rotation: new THREE.Euler(0, rotation * Math.PI / 180, 0)
        };
    };

    const placeEnvironmentModel = async (blockType = currentBlockType, mesh = placeholderMesh) => {
        try {
            // Get current state before any modifications
            const currentState = {
                terrain: await DatabaseManager.getData(STORES.TERRAIN, 'current') || {},
                environment: await DatabaseManager.getData(STORES.ENVIRONMENT, 'current') || []
            };

            if (!blockType || !mesh) {
                console.warn('Missing required data for placing environment model:', {
                    blockType: !!blockType,
                    mesh: !!mesh
                });
                return null;
            }

            // Ensure we're working with an environment model
            if (!blockType.isEnvironment) {
                console.warn('Attempted to place non-environment model:', blockType);
                return null;
            }

            const modelData = environmentModels.find(model => model.id === blockType.id);
            if (!modelData) {
                console.warn('Model data not found for type:', blockType);
                return null;
            }

            const modelUrl = modelData.modelUrl;
            const instancedData = instancedMeshes.current.get(modelUrl);
            
            if (!instancedData) {
                console.warn('No instanced data found for model:', modelUrl);
                return null;
            }

            const centerPosition = mesh.position.clone();
            const rotation = mesh.rotation.clone();
            const scale = mesh.scale.clone();

            // Define positions based on placementSize
            let positions = [centerPosition.clone()]; // Default to single placement

            if (placementSize === "cross") {
                positions = [
                    centerPosition.clone(),
                    centerPosition.clone().add(new THREE.Vector3(0, 0, -1)),
                    centerPosition.clone().add(new THREE.Vector3(0, 0, 1)),
                    centerPosition.clone().add(new THREE.Vector3(-1, 0, 0)),
                    centerPosition.clone().add(new THREE.Vector3(1, 0, 0))
                ];
            } else if (placementSize === "diamond") {
                positions = [
                    centerPosition.clone(),
                    // Inner ring
                    centerPosition.clone().add(new THREE.Vector3(0, 0, -1)),
                    centerPosition.clone().add(new THREE.Vector3(0, 0, 1)),
                    centerPosition.clone().add(new THREE.Vector3(-1, 0, 0)),
                    centerPosition.clone().add(new THREE.Vector3(1, 0, 0)),
                    // Outer ring
                    centerPosition.clone().add(new THREE.Vector3(0, 0, -2)),
                    centerPosition.clone().add(new THREE.Vector3(0, 0, 2)),
                    centerPosition.clone().add(new THREE.Vector3(-2, 0, 0)),
                    centerPosition.clone().add(new THREE.Vector3(2, 0, 0)),
                    centerPosition.clone().add(new THREE.Vector3(-1, 0, -1)),
                    centerPosition.clone().add(new THREE.Vector3(-1, 0, 1)),
                    centerPosition.clone().add(new THREE.Vector3(1, 0, -1)),
                    centerPosition.clone().add(new THREE.Vector3(1, 0, 1))
                ];
            } else if (placementSize === "square9") {
                positions = [];
                for (let x = -1; x <= 1; x++) {
                    for (let z = -1; z <= 1; z++) {
                        positions.push(centerPosition.clone().add(new THREE.Vector3(x, 0, z)));
                    }
                }
            } else if (placementSize === "square16") {
                positions = [];
                for (let x = -2; x <= 1; x++) {
                    for (let z = -2; z <= 1; z++) {
                        positions.push(centerPosition.clone().add(new THREE.Vector3(x, 0, z)));
                    }
                }
            }

            // Place instances at all positions
            positions.forEach((position) => {
                // Get randomized or fixed transform for this instance
                const transform = getPlacementTransform();
                
                const matrix = new THREE.Matrix4();
                matrix.compose(
                    position,
                    new THREE.Quaternion().setFromEuler(transform.rotation),
                    transform.scale
                );

                const instanceId = instancedData.instances.size;
                
                instancedData.meshes.forEach(mesh => {
                    mesh.count++;
                    
                    if (instanceId >= mesh.instanceMatrix.count) {
                        expandInstancedMeshCapacity(modelUrl);
                    }

                    mesh.setMatrixAt(instanceId, matrix);
                    mesh.instanceMatrix.needsUpdate = true;
                });

                // Store instance data
                instancedData.instances.set(instanceId, {
                    position,
                    rotation: transform.rotation,
                    scale: transform.scale,
                    matrix
                });
            });

            ///console.log("placed environment at", position.x, position.y, position.z);

            // Save the new environment state
            const newEnvironmentState = Array.from(instancedMeshes.current.entries()).flatMap(([modelUrl, instancedData]) => {
                const modelData = environmentModels.find(model => model.modelUrl === modelUrl);
                return Array.from(instancedData.instances.entries()).map(([instanceId, data]) => ({
                    modelUrl,
                    name: modelData?.name,
                    instanceId,
                    position: data.position,
                    rotation: data.rotation,
                    scale: data.scale
                }));
            });

            await DatabaseManager.saveData(STORES.ENVIRONMENT, 'current', newEnvironmentState);

            // Save to undo states
            const undoStates = await DatabaseManager.getData(STORES.UNDO, 'states') || [];
            await DatabaseManager.saveData(STORES.UNDO, 'states', [currentState, ...undoStates].slice(0, MAX_UNDO_STATES));
            
            // Clear redo states
            await DatabaseManager.saveData(STORES.REDO, 'states', []);

            setTotalEnvironmentObjects(newEnvironmentState.length);

            return {
                modelUrl: blockType.modelUrl,
                instanceId: instancedMeshes.current.get(blockType.modelUrl)?.instances.size - 1,
                position: mesh.position.clone(),
                rotation: mesh.rotation.clone(),
                scale: mesh.scale.clone()
            };
        } catch (error) {
            console.error('Error in placeEnvironmentModel:', error);
            return null;
        }
    };

    const updateLocalStorage = async () => {
        const allObjects = [];
        
        // Collect all instances from all models
        for (const [modelUrl, instancedData] of instancedMeshes.current) {
            // Find the corresponding model data to get the name
            const modelData = environmentModels.find(model => model.modelUrl === modelUrl);
            
            instancedData.instances.forEach((data, instanceId) => {
                allObjects.push({
                    modelUrl,
                    name: modelData?.name, // Add model name to saved data
                    instanceId,
                    position: data.position,
                    rotation: data.rotation,
                    scale: data.scale
                });
            });
        }

        // Save to IndexedDB
        try {
            await DatabaseManager.saveData(STORES.ENVIRONMENT, 'current', allObjects);
        } catch (error) {
            console.warn('Failed to save to IndexedDB:', error);
        }

        setTotalEnvironmentObjects(allObjects.length);
    };

    const expandInstancedMeshCapacity = (modelUrl) => {
        const instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData) return;

        instancedData.meshes.forEach(oldMesh => {
            const newCapacity = oldMesh.instanceMatrix.count * 2;

            const newMesh = new THREE.InstancedMesh(
                oldMesh.geometry,
                oldMesh.material,
                newCapacity
            );

            // Copy existing instances
            newMesh.count = oldMesh.count;
            newMesh.instanceMatrix.array.set(oldMesh.instanceMatrix.array);
            newMesh.instanceMatrix.needsUpdate = true;

            // Replace in scene
            scene.remove(oldMesh);
            scene.add(newMesh);
            
            // Replace the old mesh with the new one in the meshes array
            const index = instancedData.meshes.indexOf(oldMesh);
            if (index !== -1) {
                instancedData.meshes[index] = newMesh;
            }
        });
    };

    const updateInstanceTransform = (modelUrl, instanceId, position, rotation, scale) => {
        const instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData || instanceId >= instancedData.mesh.count) return;

        const matrix = new THREE.Matrix4();
        matrix.compose(
            position,
            new THREE.Quaternion().setFromEuler(rotation),
            scale
        );

        instancedData.mesh.setMatrixAt(instanceId, matrix);
        instancedData.mesh.instanceMatrix.needsUpdate = true;
        instancedData.instances.set(instanceId, {
            position: position.clone(),
            rotation: rotation.clone(),
            scale: scale.clone(),
            matrix: matrix.clone()
        });
    };

    const removeInstance = (modelUrl, instanceId) => {
        const instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData || !instancedData.instances.has(instanceId)) return;

        // Move last instance to this slot if it's not the last one
        const lastInstanceId = Array.from(instancedData.instances.keys()).pop();
        
        if (instanceId !== lastInstanceId) {
            const lastInstance = instancedData.instances.get(lastInstanceId);
            instancedData.meshes.forEach(mesh => {
                mesh.setMatrixAt(instanceId, lastInstance.matrix);
                mesh.instanceMatrix.needsUpdate = true;
            });
            instancedData.instances.set(instanceId, lastInstance);
        }
        
        // Update all meshes
        instancedData.meshes.forEach(mesh => {
            mesh.count--;
            mesh.instanceMatrix.needsUpdate = true;
        });
        
        instancedData.instances.delete(lastInstanceId);
    };

    const updatePreviewPosition = (position) => {
        //console.log("updatePreviewPosition", position);
        if (placeholderMesh) {
            placeholderMesh.position.copy(position.clone().add(positionOffset.current));
        }
    };

    const removePreview = () => {
        if (placeholderMesh) {
            // Remove from scene
            scene.remove(placeholderMesh);
            
            // Clean up materials to prevent memory leaks
            placeholderMesh.traverse((child) => {
                if (child.isMesh) {
                    if (child.material) {
                        // Dispose of materials
                        if (Array.isArray(child.material)) {
                            child.material.forEach(material => material.dispose());
                        } else {
                            child.material.dispose();
                        }
                    }
                    // Dispose of geometries
                    if (child.geometry) {
                        child.geometry.dispose();
                    }
                }
            });

            // Clear the reference
            setPlaceholderMesh(null);
            ///console.log('Preview model removed and cleaned up');
        }
    };

    const rotatePreview = (angle) => {
        if (placeholderMesh) {
            placeholderMesh.rotation.y += angle;
        }
    };

    const setScale = (scale) => {
        setScale(scale);
        if (placeholderMesh) {
            placeholderMesh.scale.set(scale, scale, scale);
        }
    };

    useImperativeHandle(ref, () => ({
        getObjectByPosition,
        updateModelPreview,
        removePreview,
        rotatePreview,
        setScale,
        placeEnvironmentModel: () => placeEnvironmentModel(),
        preloadModels,
        clearEnvironments,
        updateInstanceTransform,
        removeInstance,
        updatePreviewPosition,
        loadSavedEnvironment,
        loadCustomModel: async (modelData) => {
            try {
                // Load the model
                const gltf = await loadModel(modelData.modelUrl);
                
                // Set up instanced mesh for the new model
                await setupInstancedMesh(modelData, gltf);
                
                return true;
            } catch (error) {
                console.error('Error loading custom model:', error);
                throw error;
            }
        }
    }));

    // Return null since this component doesn't need to render anything visible
    return null;
});

export default EnvironmentBuilder;
