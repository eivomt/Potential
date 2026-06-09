    import * as THREE from "three";
    
    
    // Debug Mode
    export function printToConsole(camera) {
        console.log('camera position X:' + camera.position.x)
        console.log('camera position Y:' + camera.position.y)
        console.log('camera position Z:' + camera.position.z)

        console.log('camera rotation:' + camera.rotation.x)
        console.log(camera)
    }


    export function getTopViewQuaternion(target, radius=2) {
        const tempCam = new THREE.OrthographicCamera()

        tempCam.position.copy(target).add(new THREE.Vector3(0,radius,0))
        tempCam.up.set(0,0,-1)
        tempCam.lookAt(target)

        return tempCam.quaternion.clone()
    }

    export function moveCamera(camera, endQuaternion, endPos, radius=2, duration=1) {
        const startPos = camera.position.clone()
        // const endPos = target.clone().add(new THREE.Vector3(0,radius,0))

        const startQuaternion = camera.quaternion.clone()

        const tempQuaternion = new THREE.Quaternion()
        const tempPos = new THREE.Vector3()
        const startTime = performance.now()

        function easeInOutCubic(t) {
            return t < 0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2
        }

        function updateCamera(now) {
            const elapsed = (now - startTime) / 1000
            const t = Math.min(elapsed / duration, 1)
            const k = easeInOutCubic(t)

            tempPos.lerpVectors(startPos, endPos, k)
            tempQuaternion.slerpQuaternions(startQuaternion, endQuaternion, k)

            camera.position.copy(tempPos)
            camera.quaternion.copy(tempQuaternion)

            if (t<1) requestAnimationFrame(updateCamera)
        }

        requestAnimationFrame(updateCamera)
    }