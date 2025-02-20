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

const EnvironmentBuilder = ({ scene, previewPositionFromAppJS, currentBlockType, mode, onTotalObjectsChange, placementSize = 'single', placementSettings}, ref) => {

    // Convert class properties to refs and state
    const loader = useRef(new GLTFLoader());
    const placeholderMeshRef = useRef(null);
    const loadedModels = useRef(new Map());
    const instancedMeshes = useRef(new Map());
    const positionOffset = useRef(new THREE.Vector3(0, -0.5, 0));
    const placementSizeRef = useRef(placementSize);
    const lastPreviewTransform = useRef({ 
        scale: new THREE.Vector3(1, 1, 1), 
        rotation: new THREE.Euler(0, 0, 0) 
    });
    const placementSettingsRef = useRef(placementSettings);

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

        // Reset scene transforms to ensure clean state
        gltf.scene.position.set(0, 0, 0);
        gltf.scene.rotation.set(0, 0, 0);
        gltf.scene.scale.set(1, 1, 1);
        gltf.scene.updateMatrixWorld(true);

        // Group geometries by material
        const geometriesByMaterial = new Map();
        
        gltf.scene.traverse((child) => {
            if (child.isMesh) {
                child.updateWorldMatrix(true, true);
                const worldMatrix = child.matrixWorld.clone();
                
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                
                materials.forEach((material, materialIndex) => {
                    const newMaterial = material.clone();
                    newMaterial.depthWrite = true;
                    newMaterial.depthTest = true;
                    newMaterial.transparent = true;
                    newMaterial.alphaTest = 0.5;
                    
                    const key = newMaterial.uuid;
                    if (!geometriesByMaterial.has(key)) {
                        geometriesByMaterial.set(key, {
                            material: newMaterial,
                            geometries: []
                        });
                    }
                    
                    // Clone geometry and apply world transform
                    const geometry = child.geometry.clone();
                    geometry.applyMatrix4(worldMatrix);
                    
                    if (Array.isArray(child.material)) {
                        // Handle multi-material meshes
                        const filteredGeometry = filterGeometryByMaterialIndex(geometry, materialIndex);
                        if (filteredGeometry) {
                            geometriesByMaterial.get(key).geometries.push(filteredGeometry);
                        }
                    } else {
                        geometriesByMaterial.get(key).geometries.push(geometry);
                    }
                });
            }
        });

        // Create instanced meshes
        const instancedMeshArray = [];
        for (const {material, geometries} of geometriesByMaterial.values()) {
            if (geometries.length > 0) {
                const mergedGeometry = mergeGeometries(geometries);
                const instancedMesh = new THREE.InstancedMesh(
                    mergedGeometry,
                    material,
                    10 // Initial capacity
                );
                
                instancedMesh.frustumCulled = false;
                instancedMesh.renderOrder = 1;
                instancedMesh.count = 0;
                scene.add(instancedMesh);
                instancedMeshArray.push(instancedMesh);

                mergedGeometry.computeBoundingBox();
                mergedGeometry.computeBoundingSphere();
            }
        }

        // Store all instanced meshes for this model
        instancedMeshes.current.set(modelType.modelUrl, {
            meshes: instancedMeshArray,
            instances: new Map(),
            modelHeight: boundingHeight
        });
    };

    // Helper function to filter geometry by material index
    const filterGeometryByMaterialIndex = (geometry, materialIndex) => {
        if (!geometry.groups || geometry.groups.length === 0) return geometry;

        const newGeometry = geometry.clone();
        const indices = [];
        
        for (let i = 0; i < geometry.index.count; i += 3) {
            const faceIndex = Math.floor(i / 3);
            const group = geometry.groups.find(g => 
                faceIndex >= g.start / 3 && 
                faceIndex < (g.start + g.count) / 3
            );
            
            if (group && group.materialIndex === materialIndex) {
                indices.push(
                    geometry.index.array[i],
                    geometry.index.array[i + 1],
                    geometry.index.array[i + 2]
                );
            }
        }
        
        if (indices.length === 0) return null;
        
        newGeometry.setIndex(indices);
        return newGeometry;
    };

    const setupPreview = async (position) => {
        if (!currentBlockType) return;

        try {
            const gltf = await loadModel(currentBlockType.modelUrl);
            if (!gltf) {
                console.error('Failed to load model for preview');
                return;
            }

            if (!instancedMeshes.current.has(currentBlockType.modelUrl)) {
                setupInstancedMesh(currentBlockType, gltf);
            }

            // 2) CREATE a new preview model
            const previewModel = gltf.scene.clone(true);

            previewModel.traverse((child) => {
                if (child.isMesh) {
                    child.material = Array.isArray(child.material)
                        ? child.material.map(m => m.clone())
                        : child.material.clone();

                    if (Array.isArray(child.material)) {
                        child.material.forEach(material => {
                            material.transparent = true;
                            material.opacity = 0.5;
                            material.depthWrite = false;
                            material.depthTest = true;
                        });
                    } else {
                        child.material.transparent = true;
                        child.material.opacity = 0.5;
                        child.material.depthWrite = false;
                        child.material.depthTest = true;
                    }
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            previewModel.userData.modelId = currentBlockType.id;

            // 3) Generate random transform once, store in lastPreviewTransform
            const transform = getPlacementTransform();
            lastPreviewTransform.current.scale.copy(transform.scale);
            lastPreviewTransform.current.rotation.copy(transform.rotation);

            // 4) Apply that transform to the preview model
            previewModel.scale.copy(lastPreviewTransform.current.scale);
            previewModel.rotation.copy(lastPreviewTransform.current.rotation);

            // Position the preview (if you have a valid position)
            if (position) {
                previewModel.position.copy(position).add(positionOffset.current);
            }

            // Remove old preview, then add the new one
            if (placeholderMeshRef.current) {
                removePreview();
            }
            scene.add(previewModel);
            placeholderMeshRef.current = previewModel;
        } catch (error) {
            console.error('Error setting up preview:', error);
        }
    };

    const updateModelPreview = async (position) => {
        if (!currentBlockType || !scene) {
            return;
        }

        // If not an environment type and we have a preview, remove it
        if (!currentBlockType.isEnvironment) {
            removePreview();
            return;
        }

        // Only create new preview if needed
        if (!placeholderMeshRef.current || placeholderMeshRef.current.userData.modelId !== currentBlockType.id) {
            await setupPreview(position);
        } else if (position) {
            // Just update position if preview exists
            placeholderMeshRef.current.position.copy(position.clone().add(positionOffset.current));
            placeholderMeshRef.current.scale.copy(lastPreviewTransform.current.scale);
            placeholderMeshRef.current.rotation.copy(lastPreviewTransform.current.rotation);
        }
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
        const settings = placementSettingsRef.current;
        if (!settings) {
            console.warn('No placement settings provided');
            return {
                scale: new THREE.Vector3(1, 1, 1),
                rotation: new THREE.Euler(0, 0, 0)
            };
        }

        const scaleValue = settings.randomScale
            ? getRandomValue(settings.minScale, settings.maxScale)
            : settings.scale;
        
        const rotationDegrees = settings.randomRotation
            ? getRandomValue(settings.minRotation, settings.maxRotation)
            : settings.rotation;
        
        // Apply uniform scale to all axes
        return {
            scale: new THREE.Vector3(scaleValue, scaleValue, scaleValue),
            rotation: new THREE.Euler(0, rotationDegrees * Math.PI / 180, 0)
        };
    };

    const placeEnvironmentModel = () => {
        if (!currentBlockType || !scene || !placeholderMeshRef.current) return;

        const modelData = environmentModels.find(model => model.id === currentBlockType.id);
        if (!modelData) {
            console.warn(`Could not find model with ID ${currentBlockType.id}`);
            return;
        }

        const modelUrl = modelData.modelUrl;
        const instancedData = instancedMeshes.current.get(modelUrl);
        if (!instancedData) {
            console.warn(`Could not find instanced data for model ${modelData.modelUrl}`);
            return;
        }

        // 1) Use the transform stored in lastPreviewTransform for the current item    
        const transform = lastPreviewTransform.current;

        // 2) Position from preview
        const position = placeholderMeshRef.current.position.clone();

        // Build its final matrix
        const matrix = new THREE.Matrix4();
        matrix.compose(
            position,
            new THREE.Quaternion().setFromEuler(transform.rotation),
            transform.scale
        );

        // Insert into InstancedMesh (expand capacity if needed, etc.)
        const instanceId = instancedData.instances.size;
        instancedData.meshes.forEach(mesh => {
            if (instanceId >= mesh.instanceMatrix.count) {
                expandInstancedMeshCapacity(modelUrl);
            }
            mesh.setMatrixAt(instanceId, matrix);
            mesh.count = instanceId + 1;
            mesh.instanceMatrix.needsUpdate = true;
        });

        // Save instance data
        instancedData.instances.set(instanceId, {
            position: position.clone(),
            rotation: transform.rotation.clone(),
            scale: transform.scale.clone(),
            matrix: matrix.clone()
        });

        // Save to DB, update UI counts
        updateLocalStorage();
        setTotalEnvironmentObjects(prev => prev + 1);

        // 3) Re-randomize for the *next* placement
        if (placementSettingsRef.current?.randomScale || placementSettingsRef.current?.randomRotation) {
            const nextTransform = getPlacementTransform();
            lastPreviewTransform.current = nextTransform;

            // Update the preview mesh so the user sees the new transform right away
            placeholderMeshRef.current.scale.copy(nextTransform.scale);
            placeholderMeshRef.current.rotation.copy(nextTransform.rotation);
        }
        
        return {
            modelUrl,
            instanceId,
            position,
            rotation: transform.rotation,
            scale: transform.scale
        };
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

        const newCapacity = Math.max(10, instancedData.instances.size * 2);

        instancedData.meshes.forEach(oldMesh => {
            // Create new mesh with increased capacity
            const newMesh = new THREE.InstancedMesh(
                oldMesh.geometry,
                oldMesh.material,
                newCapacity
            );
            newMesh.frustumCulled = false;
            newMesh.renderOrder = oldMesh.renderOrder;

            // Copy existing instances
            for (let i = 0; i < oldMesh.count; i++) {
                const matrix = new THREE.Matrix4();
                oldMesh.getMatrixAt(i, matrix);
                newMesh.setMatrixAt(i, matrix);
            }
            newMesh.count = oldMesh.count;
            newMesh.instanceMatrix.needsUpdate = true;

            // Replace in scene
            scene.remove(oldMesh);
            scene.add(newMesh);

            // Replace in meshes array
            const index = instancedData.meshes.indexOf(oldMesh);
            if (index !== -1) {
                instancedData.meshes[index] = newMesh;
            }

            // Clean up old mesh
            oldMesh.dispose();
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
        // 5) NO LONGER re-randomize scale/rotation here.
        //    Just move the preview to the new position.
        if (placeholderMeshRef.current && position) {
            placeholderMeshRef.current.position.copy(position.clone().add(positionOffset.current));
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
        if (currentBlockType?.isEnvironment) {
            setupPreview(previewPositionFromAppJS);
        } else if (placeholderMeshRef.current) {
            removePreview();
        }
    }, [currentBlockType]);

    // use effect for updating preview position
    useEffect(() => {
        if (previewPositionFromAppJS && currentBlockType?.isEnvironment) {
            updateModelPreview(previewPositionFromAppJS);
        }
    }, [previewPositionFromAppJS, currentBlockType]);

    // Add effect to update preview when settings change
    useEffect(() => {
        console.log('Updating preview rotation and scale, placement settings:', placementSettings);
        if (placeholderMeshRef.current && currentBlockType?.isEnvironment) {
            const transform = getPlacementTransform();
            
            // Apply transform only to the root mesh
            placeholderMeshRef.current.scale.copy(transform.scale);
            placeholderMeshRef.current.rotation.copy(transform.rotation);
        }
    }, [placementSettings]); // Watch for changes in placement settings
    
    // Add effect to track placementSize changes
    useEffect(() => {
        placementSizeRef.current = placementSize;
        // Update preview if it exists
        if (placeholderMeshRef.current && currentBlockType?.isEnvironment) {
            updateModelPreview(placeholderMeshRef.current.position.clone().sub(positionOffset.current));
        }
    }, [placementSize]);

    // Make sure to keep the ref synced with the latest prop:
    // This runs whenever the prop changes, ensuring our ref has fresh data.
    useEffect(() => {
        placementSettingsRef.current = placementSettings;
    }, [placementSettings]);

    useImperativeHandle(ref, () => ({
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
