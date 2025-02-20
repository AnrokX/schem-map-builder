import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';
import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { DatabaseManager, STORES } from './DatabaseManager';
import { UndoRedoManager } from './UndoRedo';

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

    return result;

  } catch (error) {
    console.error('Error loading environment models:', error);
    return [];
  }
})();

const EnvironmentBuilder = ({ scene, previewPositionFromAppJS, currentBlockType, mode, onTotalObjectsChange, placementSize = 'single', placementSettings = {randomScale: false, randomRotation: false, minScale: 0.5, maxScale: 1.5, minRotation: 0, maxRotation: 360, scale: 1.0, rotation: 0}}, ref) => {

    // Convert class properties to refs and state
    const loader = useRef(new GLTFLoader());
    const placeholderMeshRef = useRef(null);
    const loadedModels = useRef(new Map());
    const instancedMeshes = useRef(new Map());
    const positionOffset = useRef(new THREE.Vector3(0, -0.5, 0));
    const placementSizeRef = useRef(placementSize);

    /// state for total environment objects
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

        // Properly construct the URL
        let fullUrl;
        if (modelToLoadUrl.startsWith('blob:')) {
            fullUrl = modelToLoadUrl;
        } else if (modelToLoadUrl.startsWith('http')) {
            fullUrl = modelToLoadUrl;
        } else {
            const cleanPath = modelToLoadUrl.replace(/^\/+/, '');
            fullUrl = `${process.env.PUBLIC_URL}/${cleanPath}`;
        }

        try {
            const response = await fetch(fullUrl);
            if (!response.ok) {
                throw new Error(`Failed to load model: ${fullUrl}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            
            return new Promise((resolve, reject) => {
                loader.current.parse(arrayBuffer, '', 
                    (gltf) => {
                        loadedModels.current.set(modelToLoadUrl, gltf);
                        resolve(gltf);
                    },
                    (error) => reject(error)
                );
            });

        } catch (error) {
            console.error('Error loading model:', fullUrl, error);
            return null;
        }
    };

    const getObjectByPosition = (position) => {
        // Find the object in the scene that matches the position
        return scene.children.find(child => 
          child.position.x === position.x &&
          child.position.y === position.y &&
          child.position.z === position.z
        );
      }

    const preloadModels = async () => {
        // Load custom models from DB first
        try {
            const customModels = await DatabaseManager.getData(STORES.CUSTOM_MODELS, 'models');
            if (customModels) {
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
            }

            // Load and setup all models
            await Promise.all(environmentModels.map(async (model) => {
                try {
                    const gltf = await loadModel(model.modelUrl);
                    if (gltf) {
                        setupInstancedMesh(model, gltf);
                    }
                } catch (error) {
                    console.error(`Error preloading model ${model.name}:`, error);
                }
            }));

            // Load saved environment after models are loaded
            await loadSavedEnvironment();
        } catch (error) {
            console.error('Error loading custom models from DB:', error);
        }

        console.log("Models preloaded: ", loadedModels.current);
    };
    
    const setupInstancedMesh = (modelType, gltf) => {
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

    const updateModelPreview = (position) => {
        if (!currentBlockType || !scene) {
            return;
        }

        // If not an environment type and we have a preview, remove it
        if (!currentBlockType.isEnvironment) {
            removePreview();
            return;
        }

        const modelData = environmentModels.find(model => model.id === currentBlockType.id);
        if (!modelData) {
            console.warn('Model data not found for type:', currentBlockType);
            return;
        }

        // Only create new preview if needed
        if (!placeholderMeshRef.current || placeholderMeshRef.current.userData.modelId !== currentBlockType.id) {
            removePreview();
            setupPreview(position);
        } else if (position) {
            // Just update position if preview exists
            placeholderMeshRef.current.position.copy(position.clone().add(positionOffset.current));
        }
    };

    // Separate setup function to create the preview mesh
    const setupPreview = (position) => {

        console.log("setting up ENVIRONMENTpreview");
        const modelData = environmentModels.find(model => model.id === currentBlockType.id);
        if (!modelData) {
            console.warn('Model data not found for type:', currentBlockType);
            return;
        }

        const gltf = loadedModels.current.get(modelData.modelUrl);
        if (!gltf) {
            console.warn('GLTF model not loaded for preview');
            return;
        }

        // Clone the model for preview
        const previewModel = gltf.scene.clone();
        previewModel.userData.modelId = currentBlockType.id;
        
        // Get and apply transform
        const transform = getPlacementTransform();
        
        // Apply transforms only to root
        previewModel.scale.copy(transform.scale);
        previewModel.rotation.copy(transform.rotation);
        
        // Handle position, using a default if none provided
        const finalPosition = position ? 
            position.clone().add(positionOffset.current) : 
            new THREE.Vector3();
        previewModel.position.copy(finalPosition);
        
        // Make the preview semi-transparent
        previewModel.traverse((child) => {
            if (child.isMesh) {
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = 0.5;
                child.material.depthWrite = true;
                child.material.depthTest = true;
                child.material.alphaTest = 0.5;
                child.renderOrder = 2;
                child.frustumCulled = false;
            }
        });
        
        scene.add(previewModel);
        placeholderMeshRef.current = previewModel;
    };

    const loadSavedEnvironment = () => {
        DatabaseManager.getData(STORES.ENVIRONMENT, 'current')
            .then((savedEnvironment) => {
                if (Array.isArray(savedEnvironment) && savedEnvironment.length > 0) {
                    updateEnvironmentToMatch(savedEnvironment);
                } else {
                    clearEnvironments();
                }
            })
            .catch(error => {
                console.error('Error loading saved environment:', error);
                clearEnvironments();
            });
    };

    // New function to efficiently update environment
    const updateEnvironmentToMatch = (targetState) => {
        try {            
            // Make a list of all current objects
            const toRemove = [];
            for (const [modelUrl, instancedData] of instancedMeshes.current) {
                instancedData.instances.forEach((_, instanceId) => toRemove.push({ modelUrl, instanceId }));
            }

            // Remove them
            for (const obj of toRemove) {
                const instancedData = instancedMeshes.current.get(obj.modelUrl);
                if (instancedData) {
                    removeInstance(obj.modelUrl, obj.instanceId);
                }
            }

            // Replace with new state
            for (const obj of targetState) {
                const modelType = environmentModels.find(model => model.name === obj.name);
                if (modelType) {
                    const tempMesh = new THREE.Object3D();
                    tempMesh.position.copy(obj.position);
                    tempMesh.rotation.copy(obj.rotation);
                    tempMesh.scale.copy(obj.scale);
                    
                    // Use a version of placeEnvironmentModel that doesn't save state
                    placeEnvironmentModelWithoutSaving({ ...modelType, isEnvironment: true }, tempMesh);
                }
            }

            // Save to DB
            updateLocalStorage();

            // Update total count
            setTotalEnvironmentObjects(targetState.length);

        } catch (error) {
            console.error('Error updating environment:', error);
        }
    };

    // New function that places without saving state
    const placeEnvironmentModelWithoutSaving = (blockType, mesh) => {
        if (!blockType || !mesh) {
            console.warn(`blockType and mesh null`);
            return null;
        }

        const modelData = environmentModels.find(model => model.id === blockType.id);
        if (!modelData) {
            console.warn(`Could not find model with ID ${blockType.id}`);
            return null;
        }

        const modelUrl = modelData.modelUrl;
        const instancedData = instancedMeshes.current.get(modelUrl);
        
        if (!instancedData) {
            console.warn(`Could not find instanced data for model ${modelData.modelUrl}`);
            return null;
        }

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
        if (!placementSettings) {
            console.warn('No placement settings provided');
            return {
                scale: new THREE.Vector3(1, 1, 1),
                rotation: new THREE.Euler(0, 0, 0)
            };
        }

        const scale = placementSettings.randomScale
            ? getRandomValue(placementSettings.minScale, placementSettings.maxScale)
            : placementSettings.scale;
        
        const rotationDegrees = placementSettings.randomRotation
            ? getRandomValue(placementSettings.minRotation, placementSettings.maxRotation)
            : placementSettings.rotation;
        
        return {
            scale: new THREE.Vector3(scale, scale, scale),
            rotation: new THREE.Euler(0, rotationDegrees * Math.PI / 180, 0)
        };
    };

    const placeEnvironmentModel = (blockType = currentBlockType, mesh = placeholderMeshRef.current) => {
        if (!scene) {
            console.warn('Scene not available');
            return null;
        }

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
        const baseRotation = mesh.rotation.clone();
        const baseScale = mesh.scale.clone();

        // Define positions based on placementSize
        let positions = [centerPosition.clone()]; // Default to single placement

        console.log("placementSize", placementSizeRef.current);

        if (placementSizeRef.current === "cross") {
            positions = [
                centerPosition.clone(),
                centerPosition.clone().add(new THREE.Vector3(0, 0, -1)),
                centerPosition.clone().add(new THREE.Vector3(0, 0, 1)),
                centerPosition.clone().add(new THREE.Vector3(-1, 0, 0)),
                centerPosition.clone().add(new THREE.Vector3(1, 0, 0))
            ];
        } else if (placementSizeRef.current === "diamond") {
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
        } else if (placementSizeRef.current === "square9") {
            positions = [];
            for (let x = -1; x <= 1; x++) {
                for (let z = -1; z <= 1; z++) {
                    positions.push(centerPosition.clone().add(new THREE.Vector3(x, 0, z)));
                }
            }
        } else if (placementSizeRef.current === "square16") {
            positions = [];
            for (let x = -2; x <= 1; x++) {
                for (let z = -2; z <= 1; z++) {
                    positions.push(centerPosition.clone().add(new THREE.Vector3(x, 0, z)));
                }
            }
        }

        // Place instances at all positions
        const placedInstances = positions.map((position) => {
            const transform = getPlacementTransform();
            
            // Create matrix from position and transform
            const matrix = new THREE.Matrix4();
            matrix.compose(
                position,
                new THREE.Quaternion().setFromEuler(transform.rotation),
                transform.scale
            );

            const instanceId = instancedData.instances.size;
            
            // Update all meshes for this instance
            instancedData.meshes.forEach(mesh => {
                if (instanceId >= mesh.instanceMatrix.count) {
                    expandInstancedMeshCapacity(modelUrl);
                }
                mesh.count++;
                mesh.setMatrixAt(instanceId, matrix);
                mesh.instanceMatrix.needsUpdate = true;
            });

            // Store instance data
            instancedData.instances.set(instanceId, {
                position: position.clone(),
                rotation: transform.rotation.clone(),
                scale: transform.scale.clone(),
                matrix: matrix.clone()
            });

            return {
                modelUrl,
                instanceId,
                position: position.clone(),
                rotation: transform.rotation.clone(),
                scale: transform.scale.clone()
            };
        });

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

        DatabaseManager.saveData(STORES.ENVIRONMENT, 'current', newEnvironmentState);

        // Save undo state with only the added instances
        UndoRedoManager.saveUndo({
            environment: {
                added: placedInstances,
                removed: []
            }
        });

        setTotalEnvironmentObjects(newEnvironmentState.length);

        return placedInstances[0]; // Return first instance for compatibility
    };

    const updateLocalStorage = () => {
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

        DatabaseManager.saveData(STORES.ENVIRONMENT, 'current', allObjects);
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
        if (!instancedData) return;

        const matrix = new THREE.Matrix4();
        matrix.compose(
            position,
            new THREE.Quaternion().setFromEuler(rotation),
            scale
        );

        instancedData.meshes.forEach(mesh => {
            mesh.setMatrixAt(instanceId, matrix);
            mesh.instanceMatrix.needsUpdate = true;
        });

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
        if (placeholderMeshRef.current) {
            const transform = getPlacementTransform();
            
            // Apply transform only to the root mesh
            placeholderMeshRef.current.position.copy(position.clone().add(positionOffset.current));
            placeholderMeshRef.current.scale.copy(transform.scale);
            placeholderMeshRef.current.rotation.copy(transform.rotation);
        }
    };

    const removePreview = () => {

        console.log("removing ENVIRONMENTpreview");
        if (placeholderMeshRef.current) {
            // Remove from scene
            scene.remove(placeholderMeshRef.current);
            
            // Clean up materials to prevent memory leaks
            placeholderMeshRef.current.traverse((child) => {
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
            placeholderMeshRef.current = null;
            ///console.log('Preview model removed and cleaned up');
        }
    };

    const rotatePreview = (angle) => {
        if (placeholderMeshRef.current) {
            placeholderMeshRef.current.rotation.y += angle;
        }
    };

    const setScale = (scale) => {
        setScale(scale);
        if (placeholderMeshRef.current) {
            placeholderMeshRef.current.scale.set(scale, scale, scale);
        }
    };

    // Update the setTotalEnvironmentObjects usage
    useEffect(() => {
        onTotalObjectsChange?.(totalEnvironmentObjects);
    }, [totalEnvironmentObjects, onTotalObjectsChange]);

    // Add initialization in useEffect
    useEffect(() => {
        if (scene) {
            preloadModels().catch(error => {
                console.error("Error in preloadModels:", error);
            });
        }
    }, [scene]);

    // use effect for setting up and removing preview
    useEffect(() => {
        if (currentBlockType?.isEnvironment && !placeholderMeshRef.current) {
            setupPreview(null); // Create new preview only if none exists
        } else if (!currentBlockType?.isEnvironment && placeholderMeshRef.current) {
            removePreview(); // Remove preview if not an environment type
        }
    }, [currentBlockType, placeholderMeshRef.current]);

    /// use effect for updating preview position
    useEffect(() => {
        if (previewPositionFromAppJS && placeholderMeshRef.current) {
            updateModelPreview(previewPositionFromAppJS);
        }
    }, [previewPositionFromAppJS, placeholderMeshRef.current]);

    // Add effect to update preview when settings change
    useEffect(() => {
        console.log('Updating preview rotation and scale, placement settings:', placementSettings);
        if (placeholderMeshRef.current && currentBlockType?.isEnvironment) {
            const transform = getPlacementTransform();
            
            // Apply transform only to the root mesh
            placeholderMeshRef.current.scale.copy(transform.scale);
            placeholderMeshRef.current.rotation.copy(transform.rotation);
        }
    }, [placementSettings.current]); // Watch for changes in placement settings
    
    // Add effect to track placementSize changes
    useEffect(() => {
        placementSizeRef.current = placementSize;
        // Update preview if it exists
        if (placeholderMeshRef.current && currentBlockType?.isEnvironment) {
            updateModelPreview(placeholderMeshRef.current.position.clone().sub(positionOffset.current));
        }
    }, [placementSize]);

    useImperativeHandle(ref, () => ({
        getObjectByPosition,
        updateModelPreview,
        removePreview,
        rotatePreview,
        setScale,
        placeEnvironmentModel,
        preloadModels,
        clearEnvironments,
        updateInstanceTransform,
        removeInstance,
        updatePreviewPosition,
        loadSavedEnvironment,
        loadModel
    }), [scene, currentBlockType, placeholderMeshRef.current]);

    // Return null since this component doesn't need to render anything visible
    return null;
};

export default forwardRef(EnvironmentBuilder);
