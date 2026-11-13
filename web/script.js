// Three.js - https://github.com/mrdoob/three.js/
// RoundedBoxGeometry - https://github.com/pailhead/three-rounded-box
// Force cache bust v9

// Constant self-illumination for every sticker so colours stay vivid under the
// dark scene lighting and never dim or shift while solving (see updateTileGlow).
const TILE_GLOW = 0.6;

// Fire tablets expose Android through the WebView user agent. Keep their
// framebuffer inside a mobile GPU budget and skip its per-cubie shadow pass;
// the former 4096px soft-shadow map made the newest Fire tablet miss almost
// every frame. iOS and web keep the original high-resolution shadow.
const IS_ANDROID_DEVICE = /Android/i.test( navigator.userAgent || '' );
const ANDROID_PIXEL_RATIO_CAP = 1.25;

// Soft bridge to the iOS shell for App Store review timing. No-ops in browsers
// and on Android until a matching message handler exists.
function notifyNativePositiveMoment( reason ) {
  try {
    const handler = window.webkit
      && window.webkit.messageHandlers
      && window.webkit.messageHandlers.cubeNative;
    if ( handler && typeof handler.postMessage === 'function' ) {
      handler.postMessage( { type: 'positiveMoment', reason: String( reason || 'unknown' ) } );
    }
  } catch ( e ) {}
}

// Meaningful play once per page load — unlocks time-based review paths.
let nativePlayNotified = false;
function notifyNativePlay( reason ) {
  if ( nativePlayNotified ) return;
  nativePlayNotified = true;
  notifyNativePositiveMoment( reason || 'play' );
}

const animationEngine = ( () => {

  let uniqueID = 0;

  class AnimationEngine {

    constructor() {

      this.ids = [];
      this.animations = {};
      this.update = this.update.bind( this );
      this.raf = 0;
      this.time = 0;

    }

    update() {

      const now = performance.now();
      const delta = now - this.time;
      this.time = now;

      let i = this.ids.length;

      this.raf = i ? requestAnimationFrame( this.update ) : 0;

      while ( i-- ) {

        const animation = this.animations[ this.ids[ i ] ];
        if ( ! animation ) continue;

        // Isolate each animation: a throw in one tween's onUpdate/onComplete must
        // not abort the rest of the frame (that used to freeze the cube). Remove
        // the offender so it can't re-fire the same error every frame.
        try {
          animation.update( delta );
        } catch ( e ) {
          try { animation.stop(); } catch ( _ ) {}
          console.error( 'animationEngine: removed a faulting animation', e );
        }

      }

    }

    add( animation ) {

      animation.id = uniqueID ++;

      this.ids.push( animation.id );
      this.animations[ animation.id ] = animation;

      if ( this.raf !== 0 ) return;

      this.time = performance.now();
      this.raf = requestAnimationFrame( this.update );

    }

    remove( animation ) {

      const index = this.ids.indexOf( animation.id );

      if ( index < 0 ) return;

      this.ids.splice( index, 1 );
      delete this.animations[ animation.id ];
      animation = null;

    }

  }

  return new AnimationEngine();

} )();

function formatTime( ms ) {
  if ( ms <= 0 ) return 0;
  const seconds = Math.floor( ( ms / 1000 ) % 60 );
  const minutes = Math.floor( ms / 60000 );
  return minutes + ':' + ( seconds < 10 ? '0' : '' ) + seconds;
}

class Animation {

  constructor( start ) {

    if ( start === true ) this.start();

  }

  start() {

    animationEngine.add( this );

  }

  stop() {

    animationEngine.remove( this );

  }

  update( delta ) {}

}

class World extends Animation {

  constructor( game ) {

    super( true );

    this.game = game;

    this.container = this.game.dom.game;
    this.scene = new THREE.Scene();

    this.renderer = new THREE.WebGLRenderer( {
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    } );
    const pixelRatio = IS_ANDROID_DEVICE
      ? Math.min( window.devicePixelRatio || 1, ANDROID_PIXEL_RATIO_CAP )
      : ( window.devicePixelRatio || 1 );
    this.renderer.setPixelRatio( pixelRatio );
    this.renderer.shadowMap.enabled = ! IS_ANDROID_DEVICE;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild( this.renderer.domElement );

    this.camera = new THREE.PerspectiveCamera( 2, 1, 0.1, 10000 );

    this.stage = { width: 2, height: 3 };
    this.fov = 10;

    this.createLights();

    this.onResize = [];

    this.resize();
    window.addEventListener( 'resize', () => this.resize(), false );

  }

  update() {

    this.updateBurstParticles();
    this.updateLights();
    
    this.renderer.render( this.scene, this.camera );

  }

  updateLights() {
    const time = Date.now() * 0.001;
    this.lights.ambient.intensity = 0.6 * ( Math.sin( time * 0.5 ) * 0.05 + 1 );
    if ( ! this._rimColor ) this._rimColor = new THREE.Color();
    this._rimColor.setHSL( ( ( time * 10 ) % 360 ) / 360, 0.2, 0.9 );
    this.lights.rim.color = this._rimColor;
  }

  resize() {

    this.width = this.container.offsetWidth;
    this.height = this.container.offsetHeight;

    this.renderer.setSize( this.width, this.height );

    this.camera.fov = this.fov;
    this.camera.aspect = this.width / this.height;

    const aspect = this.stage.width / this.stage.height;
    const fovRad = this.fov * THREE.Math.DEG2RAD;

    let distance = ( aspect < this.camera.aspect )
      ? ( this.stage.height / 2 ) / Math.tan( fovRad / 2 )
      : ( this.stage.width / this.camera.aspect ) / ( 2 * Math.tan( fovRad / 2 ) );

    distance *= 0.5;

    this.camera.position.set( distance, distance, distance);
    this.camera.lookAt( this.scene.position );
    this.camera.updateProjectionMatrix();

    const docFontSize = ( aspect < this.camera.aspect )
      ? ( this.height / 100 ) * aspect
      : this.width / 100;

    document.documentElement.style.fontSize = docFontSize + 'px';

    if ( this.onResize ) this.onResize.forEach( cb => cb() );

  }

  createLights() {

    this.lights = {
      holder:  new THREE.Object3D,
      ambient: new THREE.AmbientLight( 0xf0f0ff, 0.6 ), // Subtle cool tint
      front:   new THREE.DirectionalLight( 0xffffff, 0.4 ),
      back:    new THREE.DirectionalLight( 0xfff0e0, 0.15 ), // Warm fill
      rim:     new THREE.DirectionalLight( 0xe0f0ff, 0.25 ), // Cool rim light
    };

    // Physically accurate lighting: main key light at ~45° angle
    // Shadow direction matches light direction for realism
    this.lights.front.position.set( 3, 5, 4 );
    this.lights.back.position.set( -2, -2, -1 );
    this.lights.rim.position.set( -3, 3, 4 );

    // Configure shadow for physical accuracy
    this.lights.front.castShadow = true;
    this.lights.front.shadow.mapSize.width = 4096;
    this.lights.front.shadow.mapSize.height = 4096;
    this.lights.front.shadow.camera.near = 1;
    this.lights.front.shadow.camera.far = 40; // Extended for lower shadow plane
    // Wider frustum for softer shadow edges
    this.lights.front.shadow.camera.left = -4;
    this.lights.front.shadow.camera.right = 4;
    this.lights.front.shadow.camera.top = 4;
    this.lights.front.shadow.camera.bottom = -4;
    this.lights.front.shadow.radius = 40; // Extra diffuse shadow for ultra-smooth appearance
    this.lights.front.shadow.bias = -0.0003; // Prevent shadow acne

    this.lights.holder.add( this.lights.ambient );
    this.lights.holder.add( this.lights.front );
    this.lights.holder.add( this.lights.back );
    this.lights.holder.add( this.lights.rim );

    this.scene.add( this.lights.holder );

    // Shadow plane positioned relative to cube bottom
    // Light at (3, 5, 4) hitting cube at origin casts shadow offset toward (-x, -z)
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry( 20, 20 ), // Larger plane for softer falloff
      new THREE.ShadowMaterial( { opacity: 0.08 } ) // Very subtle, soft shadow
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.set( -0.5, -3.5, -0.8 ); // Closer to cube for tighter shadow
    shadowPlane.receiveShadow = true;
    this.scene.add( shadowPlane );


  }


  spawnParticleBurst() {

    if ( !this.burstParticles ) {
      this.burstParticles = [];
    }

    // Spawn 8-12 particles from cube center
    const count = 8 + Math.floor( Math.random() * 5 );
    const colors = [ 0xf032e6, 0x42d4f4, 0xffe119, 0xbfef45, 0xf58231, 0xffffff ];
    
    for ( let i = 0; i < count; i++ ) {
      const geometry = new THREE.SphereGeometry( 0.015, 8, 8 );
      const material = new THREE.MeshBasicMaterial({
        color: colors[ Math.floor( Math.random() * colors.length ) ],
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh( geometry, material );
      
      // Start from cube center
      mesh.position.set( 0, 0, 0 );
      
      // Random velocity outward
      mesh.userData.velocity = new THREE.Vector3(
        ( Math.random() - 0.5 ) * 0.1,
        ( Math.random() - 0.5 ) * 0.1,
        ( Math.random() - 0.5 ) * 0.1
      );
      mesh.userData.life = 1.0;
      mesh.userData.decay = 0.02 + Math.random() * 0.02;
      
      this.scene.add( mesh );
      this.burstParticles.push( mesh );
    }

  }

  updateBurstParticles() {

    if ( !this.burstParticles ) return;

    for ( let i = this.burstParticles.length - 1; i >= 0; i-- ) {
      const particle = this.burstParticles[ i ];
      
      // Move particle
      particle.position.add( particle.userData.velocity );
      
      // Apply gravity if present (for solve burst)
      if ( particle.userData.gravity ) {
        particle.userData.velocity.y -= particle.userData.gravity;
      }
      
      // Slow down velocity
      particle.userData.velocity.multiplyScalar( 0.97 );
      
      // Decay life
      particle.userData.life -= particle.userData.decay;
      particle.material.opacity = Math.max( 0, particle.userData.life );
      
      // Remove dead particles
      if ( particle.userData.life <= 0 ) {
        this.scene.remove( particle );
        particle.geometry.dispose();
        particle.material.dispose();
        this.burstParticles.splice( i, 1 );
      }
    }
    
    // Update edge sparkles
    this.updateEdgeSparkles();

  }

  // Effect C: Spawn sparkles along the edges of a completed face
  spawnEdgeSparkles( faceName, color ) {

    if ( !this.edgeSparkles ) {
      this.edgeSparkles = [];
    }

    // Determine face position and orientation
    const facePositions = {
      'U': { axis: 'y', value: 0.5, normal: new THREE.Vector3( 0, 1, 0 ) },
      'D': { axis: 'y', value: -0.5, normal: new THREE.Vector3( 0, -1, 0 ) },
      'F': { axis: 'z', value: 0.5, normal: new THREE.Vector3( 0, 0, 1 ) },
      'B': { axis: 'z', value: -0.5, normal: new THREE.Vector3( 0, 0, -1 ) },
      'R': { axis: 'x', value: 0.5, normal: new THREE.Vector3( 1, 0, 0 ) },
      'L': { axis: 'x', value: -0.5, normal: new THREE.Vector3( -1, 0, 0 ) }
    };

    const faceInfo = facePositions[ faceName ];
    if ( !faceInfo ) return;

    // Spawn 25-35 sparkles along face edges
    const count = 25 + Math.floor( Math.random() * 10 );
    const sparkleColor = new THREE.Color( color );
    
    // Make sparkle brighter/whiter
    sparkleColor.lerp( new THREE.Color( 0xffffff ), 0.5 );

    for ( let i = 0; i < count; i++ ) {
      const geometry = new THREE.SphereGeometry( 0.008 + Math.random() * 0.008, 6, 6 );
      const material = new THREE.MeshBasicMaterial({
        color: sparkleColor,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
      });
      const sparkle = new THREE.Mesh( geometry, material );

      // Position along face edges
      const edge = Math.floor( Math.random() * 4 ); // 0-3 for four edges
      const t = Math.random(); // Position along edge
      
      let x = 0, y = 0, z = 0;
      const halfSize = 0.5;
      
      if ( faceInfo.axis === 'y' ) {
        y = faceInfo.value;
        if ( edge === 0 ) { x = -halfSize + t; z = -halfSize; }
        else if ( edge === 1 ) { x = halfSize; z = -halfSize + t; }
        else if ( edge === 2 ) { x = halfSize - t; z = halfSize; }
        else { x = -halfSize; z = halfSize - t; }
      } else if ( faceInfo.axis === 'z' ) {
        z = faceInfo.value;
        if ( edge === 0 ) { x = -halfSize + t; y = -halfSize; }
        else if ( edge === 1 ) { x = halfSize; y = -halfSize + t; }
        else if ( edge === 2 ) { x = halfSize - t; y = halfSize; }
        else { x = -halfSize; y = halfSize - t; }
      } else {
        x = faceInfo.value;
        if ( edge === 0 ) { y = -halfSize + t; z = -halfSize; }
        else if ( edge === 1 ) { y = halfSize; z = -halfSize + t; }
        else if ( edge === 2 ) { y = halfSize - t; z = halfSize; }
        else { y = -halfSize; z = halfSize - t; }
      }

      sparkle.position.set( x, y, z );

      // Velocity: outward from face normal + random spread
      const speed = 0.02 + Math.random() * 0.03;
      sparkle.userData.velocity = new THREE.Vector3(
        faceInfo.normal.x * speed + ( Math.random() - 0.5 ) * 0.02,
        faceInfo.normal.y * speed + ( Math.random() - 0.5 ) * 0.02 + 0.01, // slight upward bias
        faceInfo.normal.z * speed + ( Math.random() - 0.5 ) * 0.02
      );
      sparkle.userData.life = 1.0;
      sparkle.userData.decay = 0.015 + Math.random() * 0.015; // 500ms-ish lifespan

      this.scene.add( sparkle );
      this.edgeSparkles.push( sparkle );
    }

  }

  updateEdgeSparkles() {

    if ( !this.edgeSparkles ) return;

    for ( let i = this.edgeSparkles.length - 1; i >= 0; i-- ) {
      const sparkle = this.edgeSparkles[ i ];
      
      // Move sparkle
      sparkle.position.add( sparkle.userData.velocity );
      
      // Apply slight gravity
      sparkle.userData.velocity.y -= 0.0005;
      
      // Decay life
      sparkle.userData.life -= sparkle.userData.decay;
      sparkle.material.opacity = Math.max( 0, sparkle.userData.life );
      
      // Scale down as it fades
      const scale = 0.5 + sparkle.userData.life * 0.5;
      sparkle.scale.set( scale, scale, scale );
      
      // Remove dead sparkles
      if ( sparkle.userData.life <= 0 ) {
        this.scene.remove( sparkle );
        sparkle.geometry.dispose();
        sparkle.material.dispose();
        this.edgeSparkles.splice( i, 1 );
      }
    }

  }

  // Effect B: Large particle burst for puzzle solve (enhanced version)
  spawnSolveBurst() {

    if ( !this.burstParticles ) {
      this.burstParticles = [];
    }

    // Large burst of 120+ particles for solve celebration
    const count = 120 + Math.floor( Math.random() * 30 );
    const colors = [ 0xf032e6, 0x42d4f4, 0xffe119, 0xbfef45, 0xf58231, 0xffffff ];
    
    for ( let i = 0; i < count; i++ ) {
      const geometry = new THREE.SphereGeometry( 0.02 + Math.random() * 0.02, 8, 8 );
      const material = new THREE.MeshBasicMaterial({
        color: colors[ Math.floor( Math.random() * colors.length ) ],
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh( geometry, material );
      
      // Start from cube center with slight random offset
      mesh.position.set(
        ( Math.random() - 0.5 ) * 0.2,
        ( Math.random() - 0.5 ) * 0.2,
        ( Math.random() - 0.5 ) * 0.2
      );
      
      // Strong outward velocity (explosion)
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      const speed = 0.08 + Math.random() * 0.12;
      
      mesh.userData.velocity = new THREE.Vector3(
        Math.sin( phi ) * Math.cos( theta ) * speed,
        Math.sin( phi ) * Math.sin( theta ) * speed + 0.02, // upward bias
        Math.cos( phi ) * speed
      );
      mesh.userData.life = 1.0;
      mesh.userData.decay = 0.008 + Math.random() * 0.008; // 1-2 second lifespan
      mesh.userData.gravity = 0.001; // gravity effect
      
      this.scene.add( mesh );
      this.burstParticles.push( mesh );
    }

  }

}

function RoundedBoxGeometry( size, radius, radiusSegments ) {

  THREE.BufferGeometry.call( this );

  this.type = 'RoundedBoxGeometry';

  radiusSegments = ! isNaN( radiusSegments ) ? Math.max( 1, Math.floor( radiusSegments ) ) : 1;

  var width, height, depth;

  width = height = depth = size;
  radius = size * radius;

  radius = Math.min( radius, Math.min( width, Math.min( height, Math.min( depth ) ) ) / 2 );

  var edgeHalfWidth = width / 2 - radius;
  var edgeHalfHeight = height / 2 - radius;
  var edgeHalfDepth = depth / 2 - radius;

  this.parameters = {
    width: width,
    height: height,
    depth: depth,
    radius: radius,
    radiusSegments: radiusSegments
  };

  var rs1 = radiusSegments + 1;
  var totalVertexCount = ( rs1 * radiusSegments + 1 ) << 3;

  var positions = new THREE.BufferAttribute( new Float32Array( totalVertexCount * 3 ), 3 );
  var normals = new THREE.BufferAttribute( new Float32Array( totalVertexCount * 3 ), 3 );

  var
    cornerVerts = [],
    cornerNormals = [],
    normal = new THREE.Vector3(),
    vertex = new THREE.Vector3(),
    vertexPool = [],
    normalPool = [],
    indices = []
  ;

  var
    lastVertex = rs1 * radiusSegments,
    cornerVertNumber = rs1 * radiusSegments + 1
  ;

  doVertices();
  doFaces();
  doCorners();
  doHeightEdges();
  doWidthEdges();
  doDepthEdges();

  function doVertices() {

    var cornerLayout = [
      new THREE.Vector3( 1, 1, 1 ),
      new THREE.Vector3( 1, 1, - 1 ),
      new THREE.Vector3( - 1, 1, - 1 ),
      new THREE.Vector3( - 1, 1, 1 ),
      new THREE.Vector3( 1, - 1, 1 ),
      new THREE.Vector3( 1, - 1, - 1 ),
      new THREE.Vector3( - 1, - 1, - 1 ),
      new THREE.Vector3( - 1, - 1, 1 )
    ];

    for ( var j = 0; j < 8; j ++ ) {

      cornerVerts.push( [] );
      cornerNormals.push( [] );

    }

    var PIhalf = Math.PI / 2;
    var cornerOffset = new THREE.Vector3( edgeHalfWidth, edgeHalfHeight, edgeHalfDepth );

    for ( var y = 0; y <= radiusSegments; y ++ ) {

      var v = y / radiusSegments;
      var va = v * PIhalf;
      var cosVa = Math.cos( va );
      var sinVa = Math.sin( va );

      if ( y == radiusSegments ) {

        vertex.set( 0, 1, 0 );
        var vert = vertex.clone().multiplyScalar( radius ).add( cornerOffset );
        cornerVerts[ 0 ].push( vert );
        vertexPool.push( vert );
        var norm = vertex.clone();
        cornerNormals[ 0 ].push( norm );
        normalPool.push( norm );
        continue;

      }

      for ( var x = 0; x <= radiusSegments; x ++ ) {

        var u = x / radiusSegments;
        var ha = u * PIhalf;
        vertex.x = cosVa * Math.cos( ha );
        vertex.y = sinVa;
        vertex.z = cosVa * Math.sin( ha );

        var vert = vertex.clone().multiplyScalar( radius ).add( cornerOffset );
        cornerVerts[ 0 ].push( vert );
        vertexPool.push( vert );

        var norm = vertex.clone().normalize();
        cornerNormals[ 0 ].push( norm );
        normalPool.push( norm );

      }

    }

    for ( var i = 1; i < 8; i ++ ) {

      for ( var j = 0; j < cornerVerts[ 0 ].length; j ++ ) {

        var vert = cornerVerts[ 0 ][ j ].clone().multiply( cornerLayout[ i ] );
        cornerVerts[ i ].push( vert );
        vertexPool.push( vert );

        var norm = cornerNormals[ 0 ][ j ].clone().multiply( cornerLayout[ i ] );
        cornerNormals[ i ].push( norm );
        normalPool.push( norm );

      }

    }

  }

  function doCorners() {

    var flips = [
      true,
      false,
      true,
      false,
      false,
      true,
      false,
      true
    ];

    var lastRowOffset = rs1 * ( radiusSegments - 1 );

    for ( var i = 0; i < 8; i ++ ) {

      var cornerOffset = cornerVertNumber * i;

      for ( var v = 0; v < radiusSegments - 1; v ++ ) {

        var r1 = v * rs1;
        var r2 = ( v + 1 ) * rs1;

        for ( var u = 0; u < radiusSegments; u ++ ) {

          var u1 = u + 1;
          var a = cornerOffset + r1 + u;
          var b = cornerOffset + r1 + u1;
          var c = cornerOffset + r2 + u;
          var d = cornerOffset + r2 + u1;

          if ( ! flips[ i ] ) {

            indices.push( a );
            indices.push( b );
            indices.push( c );

            indices.push( b );
            indices.push( d );
            indices.push( c );

          } else {

            indices.push( a );
            indices.push( c );
            indices.push( b );

            indices.push( b );
            indices.push( c );
            indices.push( d );

          }

        }

      }

      for ( var u = 0; u < radiusSegments; u ++ ) {

        var a = cornerOffset + lastRowOffset + u;
        var b = cornerOffset + lastRowOffset + u + 1;
        var c = cornerOffset + lastVertex;

        if ( ! flips[ i ] ) {

          indices.push( a );
          indices.push( b );
          indices.push( c );

        } else {

          indices.push( a );
          indices.push( c );
          indices.push( b );

        }

      }

    }

  }

  function doFaces() {

    var a = lastVertex;
    var b = lastVertex + cornerVertNumber;
    var c = lastVertex + cornerVertNumber * 2;
    var d = lastVertex + cornerVertNumber * 3;

    indices.push( a );
    indices.push( b );
    indices.push( c );
    indices.push( a );
    indices.push( c );
    indices.push( d );

    a = lastVertex + cornerVertNumber * 4;
    b = lastVertex + cornerVertNumber * 5;
    c = lastVertex + cornerVertNumber * 6;
    d = lastVertex + cornerVertNumber * 7;

    indices.push( a );
    indices.push( c );
    indices.push( b );
    indices.push( a );
    indices.push( d );
    indices.push( c );

    a = 0;
    b = cornerVertNumber;
    c = cornerVertNumber * 4;
    d = cornerVertNumber * 5;

    indices.push( a );
    indices.push( c );
    indices.push( b );
    indices.push( b );
    indices.push( c );
    indices.push( d );

    a = cornerVertNumber * 2;
    b = cornerVertNumber * 3;
    c = cornerVertNumber * 6;
    d = cornerVertNumber * 7;

    indices.push( a );
    indices.push( c );
    indices.push( b );
    indices.push( b );
    indices.push( c );
    indices.push( d );

    a = radiusSegments;
    b = radiusSegments + cornerVertNumber * 3;
    c = radiusSegments + cornerVertNumber * 4;
    d = radiusSegments + cornerVertNumber * 7;

    indices.push( a );
    indices.push( b );
    indices.push( c );
    indices.push( b );
    indices.push( d );
    indices.push( c );

    a = radiusSegments + cornerVertNumber;
    b = radiusSegments + cornerVertNumber * 2;
    c = radiusSegments + cornerVertNumber * 5;
    d = radiusSegments + cornerVertNumber * 6;

    indices.push( a );
    indices.push( c );
    indices.push( b );
    indices.push( b );
    indices.push( c );
    indices.push( d );

  }

  function doHeightEdges() {

    for ( var i = 0; i < 4; i ++ ) {

      var cOffset = i * cornerVertNumber;
      var cRowOffset = 4 * cornerVertNumber + cOffset;
      var needsFlip = i & 1 === 1;

      for ( var u = 0; u < radiusSegments; u ++ ) {

        var u1 = u + 1;
        var a = cOffset + u;
        var b = cOffset + u1;
        var c = cRowOffset + u;
        var d = cRowOffset + u1;

        if ( ! needsFlip ) {

          indices.push( a );
          indices.push( b );
          indices.push( c );
          indices.push( b );
          indices.push( d );
          indices.push( c );

        } else {

          indices.push( a );
          indices.push( c );
          indices.push( b );
          indices.push( b );
          indices.push( c );
          indices.push( d );

        }

      }

    }

  }

  function doDepthEdges() {

    var cStarts = [ 0, 2, 4, 6 ];
    var cEnds = [ 1, 3, 5, 7 ];

    for ( var i = 0; i < 4; i ++ ) {

      var cStart = cornerVertNumber * cStarts[ i ];
      var cEnd = cornerVertNumber * cEnds[ i ];

      var needsFlip = 1 >= i;

      for ( var u = 0; u < radiusSegments; u ++ ) {

        var urs1 = u * rs1;
        var u1rs1 = ( u + 1 ) * rs1;

        var a = cStart + urs1;
        var b = cStart + u1rs1;
        var c = cEnd + urs1;
        var d = cEnd + u1rs1;

        if ( needsFlip ) {

          indices.push( a );
          indices.push( c );
          indices.push( b );
          indices.push( b );
          indices.push( c );
          indices.push( d );

        } else {

          indices.push( a );
          indices.push( b );
          indices.push( c );
          indices.push( b );
          indices.push( d );
          indices.push( c );

        }

      }

    }

  }

  function doWidthEdges() {

    var end = radiusSegments - 1;

    var cStarts = [ 0, 1, 4, 5 ];
    var cEnds = [ 3, 2, 7, 6 ];
    var needsFlip = [ 0, 1, 1, 0 ];

    for ( var i = 0; i < 4; i ++ ) {

      var cStart = cStarts[ i ] * cornerVertNumber;
      var cEnd = cEnds[ i ] * cornerVertNumber;

      for ( var u = 0; u <= end; u ++ ) {

        var a = cStart + radiusSegments + u * rs1;
        var b = cStart + ( u != end ? radiusSegments + ( u + 1 ) * rs1 : cornerVertNumber - 1 );

        var c = cEnd + radiusSegments + u * rs1;
        var d = cEnd + ( u != end ? radiusSegments + ( u + 1 ) * rs1 : cornerVertNumber - 1 );

        if ( ! needsFlip[ i ] ) {

          indices.push( a );
          indices.push( b );
          indices.push( c );
          indices.push( b );
          indices.push( d );
          indices.push( c );

        } else {

          indices.push( a );
          indices.push( c );
          indices.push( b );
          indices.push( b );
          indices.push( c );
          indices.push( d );

        }

      }

    }

  }

  var index = 0;

  for ( var i = 0; i < vertexPool.length; i ++ ) {

    positions.setXYZ(
      index,
      vertexPool[ i ].x,
      vertexPool[ i ].y,
      vertexPool[ i ].z
    );

    normals.setXYZ(
      index,
      normalPool[ i ].x,
      normalPool[ i ].y,
      normalPool[ i ].z
    );

    index ++;

  }

  this.setIndex( new THREE.BufferAttribute( new Uint16Array( indices ), 1 ) );
  this.addAttribute( 'position', positions );
  this.addAttribute( 'normal', normals );

}

RoundedBoxGeometry.prototype = Object.create( THREE.BufferGeometry.prototype );
RoundedBoxGeometry.constructor = RoundedBoxGeometry;

// Flat rounded-rect sticker geometry. Extruded stickers had thin side walls that
// showed adjacent face colours through cubie corners at grazing angles.
// ShapeBufferGeometry (not Extrude) keeps stickers zero-thickness.
function RoundedPlaneGeometry( size, radius ) {

  var x, y, width, height;

  x = y = - size / 2;
  width = height = size;
  radius = size * radius;

  const shape = new THREE.Shape();

  shape.moveTo( x, y + radius );
  shape.lineTo( x, y + height - radius );
  shape.quadraticCurveTo( x, y + height, x + radius, y + height );
  shape.lineTo( x + width - radius, y + height );
  shape.quadraticCurveTo( x + width, y + height, x + width, y + height - radius );
  shape.lineTo( x + width, y + radius );
  shape.quadraticCurveTo( x + width, y, x + width - radius, y );
  shape.lineTo( x + radius, y );
  shape.quadraticCurveTo( x, y, x, y + radius );

  // Buffer path matches the rest of the r95 scene graph; 6 segments smooths corners.
  return new THREE.ShapeBufferGeometry( shape, 6 );

}

class Cube {

  constructor( game ) {

    this.game = game;
    this.size = 2;

    this.geometry = {
      pieceCornerRadius: 0.09,  // Rounded cubie body; kept modest to limit corner peek
      edgeCornerRoundness: 0.08, // Rounded edges on sticker faces
      edgeScale: 0.92, // Tighter sticker coverage reduces gaps that expose other faces
      stickerOffset: 0.002, // Nudge stickers past the cubie body to avoid z-fighting
    };

    this.holder = new THREE.Object3D();
    this.object = new THREE.Object3D();
    this.animator = new THREE.Object3D();

    this.holder.add( this.animator );
    this.animator.add( this.object );

    this.game.world.scene.add( this.holder );

  }

  init() {

    // Drop every previous cubie (including any still parented to the flip
    // group from an aborted mid-scramble turn) before building the new size.
    this.clearGeneratedPieces();

    if ( this.size === 2 ) this.scale = 1.25;
    else if ( this.size === 3 ) this.scale = 1;
    else if ( this.size > 3 ) this.scale = 3 / this.size;

    this.object.scale.set( this.scale, this.scale, this.scale );

    const controlsScale = this.size === 2 ? 0.825 : 1;
    this.game.controls.edges.scale.set( controlsScale, controlsScale, controlsScale );
    
    this.generatePositions();
    this.generateModel();

    this.pieces.forEach( piece => {

      this.cubes.push( piece.userData.cube );
      this.object.add( piece );

    } );

    this.holder.traverse( node => {

      if ( node.frustumCulled ) node.frustumCulled = false;

    } );

    this.updateColors( this.game.themes.getColors() );

    this.sizeGenerated = this.size;

  }

  // Remove all generated cubies from the scene graph. Important: during a
  // layer turn pieces live under controls.group, not cube.object — wiping
  // object.children alone leaves those mid-turn ghosts rendering after a
  // size change (especially higher→lower while a scramble is animating).
  clearGeneratedPieces() {

    const flipGroup = this.game.controls && this.game.controls.group;

    if ( flipGroup ) {

      flipGroup.rotation.set( 0, 0, 0 );

      while ( flipGroup.children.length ) {

        flipGroup.remove( flipGroup.children[ 0 ] );

      }

      if ( this.game.controls.flipLayer ) this.game.controls.flipLayer = null;

    }

    if ( this.pieces ) {

      this.pieces.forEach( piece => {

        if ( piece.parent ) piece.parent.remove( piece );

      } );

    }

    // Keep the flip group; drop every other child. Avoid assigning
    // object.children = [] which orphans Three.js parent pointers.
    const keep = flipGroup || null;

    [ ...this.object.children ].forEach( child => {

      if ( child !== keep ) this.object.remove( child );

    } );

    if ( keep && keep.parent !== this.object ) this.object.add( keep );

    this.pieces = [];
    this.edges = [];
    this.cubes = [];

  }

  resize( force = false ) {

    if ( this.size !== this.sizeGenerated || force ) {

      this.size = this.game.preferences.ranges.size.value;

      this.reset();
      this.init();

      this.game.saved = false;
      this.game.timer.reset();
      this.game.storage.clearGame();

    }

  }

  reset() {

    this.game.controls.edges.rotation.set( 0, 0, 0 );

    this.holder.rotation.set( 0, 0, 0 );
    this.object.rotation.set( 0, 0, 0 );
    this.animator.rotation.set( 0, 0, 0 );

  }

  generatePositions() {

    const m = this.size - 1;
    const first = this.size % 2 !== 0
      ? 0 - Math.floor(this.size / 2)
      : 0.5 - this.size / 2;

    let x, y, z;

    this.positions = [];

    for ( x = 0; x < this.size; x ++ ) {
      for ( y = 0; y < this.size; y ++ ) {
        for ( z = 0; z < this.size; z ++ ) {

          let position = new THREE.Vector3(first + x, first + y, first + z);
          let edges = [];

          if ( x == 0 ) edges.push(0);
          if ( x == m ) edges.push(1);
          if ( y == 0 ) edges.push(2);
          if ( y == m ) edges.push(3);
          if ( z == 0 ) edges.push(4);
          if ( z == m ) edges.push(5);

          position.edges = edges;
          this.positions.push( position );

        }
      }
    }

  }

  generateModel() {

    this.pieces = [];
    this.edges = [];

    const pieceSize = 1 / 3;

    const bodyMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0x000000,
      emissiveIntensity: 0,
    });

    const stickerMaterial = new THREE.MeshStandardMaterial({
      roughness: 0.3,
      metalness: 0.1,
      emissive: 0x000000,
      emissiveIntensity: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    const pieceMesh = new THREE.Mesh(
      new RoundedBoxGeometry( pieceSize, this.geometry.pieceCornerRadius, 3 ),
      bodyMaterial.clone()
    );
    pieceMesh.renderOrder = 0;

    const edgeGeometry = RoundedPlaneGeometry(
      pieceSize,
      this.geometry.edgeCornerRoundness
    );

    this.positions.forEach( ( position, index ) => {

      const piece = new THREE.Object3D();
      const pieceCube = pieceMesh.clone();
      pieceCube.castShadow = true;
      const pieceEdges = [];

      piece.position.copy( position.clone().divideScalar( 3 ) );
      piece.add( pieceCube );
      piece.name = index;
      piece.edgesName = '';

      position.edges.forEach( position => {

        const edge = new THREE.Mesh( edgeGeometry, stickerMaterial.clone() );
        const name = [ 'L', 'R', 'D', 'U', 'B', 'F' ][ position ];
        const distance = pieceSize / 2 + this.geometry.stickerOffset;

        edge.position.set(
          distance * [ - 1, 1, 0, 0, 0, 0 ][ position ],
          distance * [ 0, 0, - 1, 1, 0, 0 ][ position ],
          distance * [ 0, 0, 0, 0, - 1, 1 ][ position ]
        );

        edge.rotation.set(
          Math.PI / 2 * [ 0, 0, 1, - 1, 0, 0 ][ position ],
          Math.PI / 2 * [ - 1, 1, 0, 0, 2, 0 ][ position ],
          0
        );

        edge.scale.set(
          this.geometry.edgeScale,
          this.geometry.edgeScale,
          this.geometry.edgeScale
        );

        edge.name = name;
        edge.renderOrder = 1;

        piece.add( edge );
        pieceEdges.push( name );
        this.edges.push( edge );

      } );

      piece.userData.edges = pieceEdges;
      piece.userData.cube = pieceCube;

      piece.userData.start = {
        position: piece.position.clone(),
        rotation: piece.rotation.clone(),
      };

      this.pieces.push( piece );

    } );

  }

  updateColors( colors ) {

    if ( typeof this.pieces !== 'object' && typeof this.edges !== 'object' ) return;

    this.pieces.forEach( piece => piece.userData.cube.material.color.setHex( colors.P ) );
    this.edges.forEach( edge => edge.material.color.setHex( colors[ edge.name ] ) );
    
    // Update glow effect after colors change
    this.updateTileGlow();

  }

  loadFromData( data ) {

    this.size = data.size;

    this.reset();
    this.init();

    this.pieces.forEach( piece => {

      const index = data.names.indexOf( piece.name );

      const position = data.positions[index];
      const rotation = data.rotations[index];

      piece.position.set( position.x, position.y, position.z );
      piece.rotation.set( rotation.x, rotation.y, rotation.z );

    } );

  }

  // Group stickers by the PHYSICAL face they currently point at, not by their
  // fixed colour identity. A sticker's colour is a pure function of edge.name
  // (see updateColors), so grouping by name always yields uniform groups and is
  // useless for measuring how solved a face is.
  //
  // The grouping is done in the cube's OWN local frame (object.worldToLocal).
  // The whole-cube viewing rotation lives on a parent of this.object, so a
  // world-space position carries that tilt and the dominant axis comes out
  // wrong whenever the player isn't looking at the cube head-on. Working in
  // local space makes detection invariant to the viewing angle. This is the
  // single source of truth for "what is on each face", used by both the solved
  // check and the progress glow.
  getFaceGroups() {
    const sides = { 'x-': [], 'x+': [], 'y-': [], 'y+': [], 'z-': [], 'z+': [] };

    this.object.updateMatrixWorld();

    this.edges.forEach( edge => {
      const position = this.object.worldToLocal(
        edge.getWorldPosition( new THREE.Vector3() )
      );

      const mainAxis = [ 'x', 'y', 'z' ].reduce(
        ( a, b ) => Math.abs( position[ a ] ) > Math.abs( position[ b ] ) ? a : b
      );
      const mainSign = position.multiplyScalar( 2 ).round()[ mainAxis ] < 1 ? '-' : '+';

      sides[ mainAxis + mainSign ].push( edge );
    } );

    return sides;
  }

  // Count how many physical faces are completely solved (all same colour)
  getSolvedFacesCount() {
    const sides = this.getFaceGroups();
    let solvedCount = 0;

    Object.keys( sides ).forEach( side => {
      const faceEdges = sides[ side ];
      if ( faceEdges.length === 0 ) return;

      const firstColor = faceEdges[0].material.color.getHex();
      const allSame = faceEdges.every( edge => edge.material.color.getHex() === firstColor );
      if ( allSame ) solvedCount++;
    } );

    return solvedCount;
  }

  // Every sticker is self-lit by a constant amount so the cube reads as vivid
  // flat colour under the dark scene lighting and never changes brightness
  // mid-solve. Earlier versions drove emissive from per-face progress, which
  // both shifted tile colours on partial matches and made the whole cube dim
  // the moment the first turn broke the (initially solved) faces. Keeping it
  // constant fixes both: the look is stable, the solve reward is the confetti.
  updateTileGlow() {
    if ( !this.edges || this.edges.length === 0 ) return;

    this.edges.forEach( edge => {
      edge.material.emissive.setHex( edge.material.color.getHex() );
      edge.material.emissiveIntensity = TILE_GLOW;
    } );
  }

}

const Easing = {

  Power: {

    In: power => {

      power = Math.round( power || 1 );

      return t => Math.pow( t, power );

    },

    Out: power => {

      power = Math.round( power || 1 );

      return t => 1 - Math.abs( Math.pow( t - 1, power ) );

    },

    InOut: power => {

      power = Math.round( power || 1 );

      return t => ( t < 0.5 )
        ? Math.pow( t * 2, power ) / 2
        : ( 1 - Math.abs( Math.pow( ( t * 2 - 1 ) - 1, power ) ) ) / 2 + 0.5;

    },

  },

  Sine: {

    In: () => t => 1 + Math.sin( Math.PI / 2 * t - Math.PI / 2 ),

    Out: () => t => Math.sin( Math.PI / 2 * t ),

    InOut: () => t => ( 1 + Math.sin( Math.PI * t - Math.PI / 2 ) ) / 2,

  },

  Back: {

    Out: s => {

      s = s || 1.70158;

      return t => { return ( t -= 1 ) * t * ( ( s + 1 ) * t + s ) + 1; };

    },

    In: s => {

      s = s || 1.70158;

      return t => { return t * t * ( ( s + 1 ) * t - s ); };

    }

  },

  Elastic: {

    Out: ( amplitude, period ) => {

      let PI2 = Math.PI * 2;

      let p1 = ( amplitude >= 1 ) ? amplitude : 1;
      let p2 = ( period || 0.3 ) / ( amplitude < 1 ? amplitude : 1 );
      let p3 = p2 / PI2 * ( Math.asin( 1 / p1 ) || 0 );

      p2 = PI2 / p2;

      return t => { return p1 * Math.pow( 2, -10 * t ) * Math.sin( ( t - p3 ) * p2 ) + 1 }

    },

  },

};

class Tween extends Animation {

  constructor( options ) {

    super( false );

    this.duration = options.duration || 500;
    this.easing = options.easing || ( t => t );
    this.onUpdate = options.onUpdate || ( () => {} );
    this.onComplete = options.onComplete || ( () => {} );

    this.delay = options.delay || false;
    this.yoyo = options.yoyo ? false : null;

    this.progress = 0;
    this.value = 0;
    this.delta = 0;

    this.getFromTo( options );

    if ( this.delay ) setTimeout( () => super.start(), this.delay );
    else super.start();

    this.onUpdate( this );

  }

  update( delta ) {

    const old = this.value * 1;
    const direction = ( this.yoyo === true ) ? - 1 : 1;

    this.progress += ( delta / this.duration ) * direction;

    this.value = this.easing( this.progress );
    this.delta = this.value - old;

    if ( this.values !== null ) this.updateFromTo();

    if ( this.yoyo !== null ) this.updateYoyo();
    else if ( this.progress <= 1 ) this.onUpdate( this );
    else {

      this.progress = 1;
      this.value = 1;
      this.onUpdate( this );
      this.onComplete( this );
      super.stop();      

    }

  }

  updateYoyo() {

    if ( this.progress > 1 || this.progress < 0 ) {

      this.value = this.progress = ( this.progress > 1 ) ? 1 : 0;
      this.yoyo = ! this.yoyo;

    }

    this.onUpdate( this );

  }

  updateFromTo() {

    this.values.forEach( key => {

      this.target[ key ] = this.from[ key ] + ( this.to[ key ] - this.from[ key ] ) * this.value;

    } );

  }

  getFromTo( options ) {

    if ( ! options.target || ! options.to ) {

      this.values = null;
      return;

    }

    this.target = options.target || null;
    this.from = options.from || {};
    this.to = options.to || null;
    this.values = [];

    if ( Object.keys( this.from ).length < 1 )
      Object.keys( this.to ).forEach( key => { this.from[ key ] = this.target[ key ]; } );

    Object.keys( this.to ).forEach( key => { this.values.push( key ); } );

  }

}

window.addEventListener( 'touchmove', () => {} );
document.addEventListener( 'touchmove',  event => { event.preventDefault(); }, { passive: false } );

class Draggable {

  constructor( element, options ) {

    this.position = {
      current: new THREE.Vector2(),
      start: new THREE.Vector2(),
      delta: new THREE.Vector2(),
      old: new THREE.Vector2(),
      drag: new THREE.Vector2(),
    };

    this.options = Object.assign( {
      calcDelta: false,
    }, options || {} );

    this.element = element;
    this.touch = null;

    this.drag = {

      start: ( event ) => {

        if ( event.type == 'mousedown' && event.which != 1 ) return;
        if ( event.type == 'touchstart' && event.touches.length > 1 ) return;

        this.getPositionCurrent( event );

        if ( this.options.calcDelta ) {

          this.position.start = this.position.current.clone();
          this.position.delta.set( 0, 0 );
          this.position.drag.set( 0, 0 );

        }

        this.touch = ( event.type == 'touchstart' );

        this.onDragStart( this.position );

        window.addEventListener( ( this.touch ) ? 'touchmove' : 'mousemove', this.drag.move, false );
        window.addEventListener( ( this.touch ) ? 'touchend' : 'mouseup', this.drag.end, false );

      },

      move: ( event ) => {

        if ( this.options.calcDelta ) {

          this.position.old = this.position.current.clone();

        }

        this.getPositionCurrent( event );

        if ( this.options.calcDelta ) {

          this.position.delta = this.position.current.clone().sub( this.position.old );
          this.position.drag = this.position.current.clone().sub( this.position.start );

        }

        this.onDragMove( this.position );

      },

      end: ( event ) => {

        this.getPositionCurrent( event );

        this.onDragEnd( this.position );

        window.removeEventListener( ( this.touch ) ? 'touchmove' : 'mousemove', this.drag.move, false );
        window.removeEventListener( ( this.touch ) ? 'touchend' : 'mouseup', this.drag.end, false );

      },

    };

    this.onDragStart = () => {};
    this.onDragMove = () => {};
    this.onDragEnd = () => {};

    this.enable();

    return this;

  }

  enable() {

    this.element.addEventListener( 'touchstart', this.drag.start, false );
    this.element.addEventListener( 'mousedown', this.drag.start, false );

    return this;

  }

  disable() {

    this.element.removeEventListener( 'touchstart', this.drag.start, false );
    this.element.removeEventListener( 'mousedown', this.drag.start, false );

    return this;

  }

  getPositionCurrent( event ) {

    const dragEvent = event.touches
      ? ( event.touches[ 0 ] || event.changedTouches[ 0 ] )
      : event;

    this.position.current.set( dragEvent.pageX, dragEvent.pageY );

  }

  convertPosition( position ) {

    position.x = ( position.x / this.element.offsetWidth ) * 2 - 1;
    position.y = - ( ( position.y / this.element.offsetHeight ) * 2 - 1 );

    return position;

  }

}

const STILL = 0;
const PREPARING = 1;
const ROTATING = 2;
const ANIMATING = 3;

class Controls {

  constructor( game ) {

    this.game = game;

    this.flipConfig = 0;

    this.flipEasings = [ Easing.Power.Out( 3 ), Easing.Sine.Out(), Easing.Back.Out( 1.5 ) ];
    this.flipSpeeds = [ 125, 200, 300 ];

    this.raycaster = new THREE.Raycaster();

    const helperMaterial = new THREE.MeshBasicMaterial( { depthWrite: false, transparent: true, opacity: 0, color: 0x0033ff } );

    this.group = new THREE.Object3D();
    this.group.name = 'controls';
    this.game.cube.object.add( this.group );

    this.helper = new THREE.Mesh(
      new THREE.PlaneBufferGeometry( 200, 200 ),
      helperMaterial.clone()
    );

    this.helper.rotation.set( 0, Math.PI / 4, 0 );
    this.game.world.scene.add( this.helper );

    this.edges = new THREE.Mesh(
      new THREE.BoxBufferGeometry( 1, 1, 1 ),
      helperMaterial.clone(),
    );

    this.game.world.scene.add( this.edges );

    this.onSolved = () => {};
    this.onMove = () => {};

    this.momentum = [];

    this.scramble = null;
    this.state = STILL;
    this.enabled = false;

    this.initDraggable();

  }

  enable() {

    this.draggable.enable();
    this.enabled = true;

  }

  disable() {

    this.draggable.disable();
    this.enabled = false;

  }

  initDraggable() {

    this.draggable = new Draggable( this.game.dom.game );

    this.draggable.onDragStart = position => {

      if ( this.scramble !== null ) return;
      if ( this.state === PREPARING || this.state === ROTATING ) return;

      this.gettingDrag = this.state === ANIMATING;

      const edgeIntersect = this.getIntersect( position.current, this.edges, false );

      if ( edgeIntersect !== false ) {

        this.dragIntersect = this.getIntersect( position.current, this.game.cube.cubes, true );

      }

      if ( edgeIntersect !== false && this.dragIntersect !== false ) {

        this.dragNormal = edgeIntersect.face.normal.round();
        this.flipType = 'layer';

        this.attach( this.helper, this.edges );

        this.helper.rotation.set( 0, 0, 0 );
        this.helper.position.set( 0, 0, 0 );
        this.helper.lookAt( this.dragNormal );
        this.helper.translateZ( 0.5 );
        this.helper.updateMatrixWorld();

        this.detach( this.helper, this.edges );

      } else {

        this.dragNormal = new THREE.Vector3( 0, 0, 1 );
        this.flipType = 'cube';

        this.helper.position.set( 0, 0, 0 );
        this.helper.rotation.set( 0, Math.PI / 4, 0 );
        this.helper.updateMatrixWorld();

      }

      let planeIntersect = this.getIntersect( position.current, this.helper, false );
      if ( planeIntersect === false ) return;

      this.dragCurrent = this.helper.worldToLocal( planeIntersect.point );
      this.dragTotal = new THREE.Vector3();
      this.state = ( this.state === STILL ) ? PREPARING : this.state;

    };

    this.draggable.onDragMove = position => {

      if ( this.scramble !== null ) return;
      if ( this.state === STILL || ( this.state === ANIMATING && this.gettingDrag === false ) ) return;

      const planeIntersect = this.getIntersect( position.current, this.helper, false );
      if ( planeIntersect === false ) return;

      const point = this.helper.worldToLocal( planeIntersect.point.clone() );

      this.dragDelta = point.clone().sub( this.dragCurrent ).setZ( 0 );
      this.dragTotal.add( this.dragDelta );
      this.dragCurrent = point;
      this.addMomentumPoint( this.dragDelta );

      if ( this.state === PREPARING && this.dragTotal.length() > 0.05 ) {

        this.dragDirection = this.getMainAxis( this.dragTotal );

        if ( this.flipType === 'layer' ) {

          const direction = new THREE.Vector3();
          direction[ this.dragDirection ] = 1;

          const worldDirection = this.helper.localToWorld( direction ).sub( this.helper.position );
          const objectDirection = this.edges.worldToLocal( worldDirection ).round();

          this.flipAxis = objectDirection.cross( this.dragNormal ).negate();

          this.selectLayer( this.getLayer( false ) );

        } else {

          const axis = ( this.dragDirection != 'x' )
            ? ( ( this.dragDirection == 'y' && position.current.x > this.game.world.width / 2 ) ? 'z' : 'x' )
            : 'y';

          this.flipAxis = new THREE.Vector3();
          this.flipAxis[ axis ] = 1 * ( ( axis == 'x' ) ? - 1 : 1 );

        }

        this.flipAngle = 0;
        this.state = ROTATING;

      } else if ( this.state === ROTATING ) {

        const rotation = this.dragDelta[ this.dragDirection ];

        if ( this.flipType === 'layer' ) { 

          this.group.rotateOnAxis( this.flipAxis, rotation );
          this.flipAngle += rotation;

        } else {

          this.edges.rotateOnWorldAxis( this.flipAxis, rotation );
          this.game.cube.object.rotation.copy( this.edges.rotation );
          this.flipAngle += rotation;

        }

      }

    };

    this.draggable.onDragEnd = position => {

      if ( this.scramble !== null ) return;
      if ( this.state !== ROTATING ) {

        this.gettingDrag = false;
        this.state = STILL;
        return;

      }

      this.state = ANIMATING;

      const momentum = this.getMomentum()[ this.dragDirection ];
      const flip = ( Math.abs( momentum ) > 0.05 && Math.abs( this.flipAngle ) < Math.PI / 2 );

      const angle = flip
        ? this.roundAngle( this.flipAngle + Math.sign( this.flipAngle ) * ( Math.PI / 4 ) )
        : this.roundAngle( this.flipAngle );

      const delta = angle - this.flipAngle;

      if ( this.flipType === 'layer' ) {

        notifyNativePlay( 'turn' );

        this.rotateLayer( delta, false, layer => {

          this.game.storage.saveGame();

          this.state = this.gettingDrag ? PREPARING : STILL;
          this.gettingDrag = false;

          this.checkIsSolved();

        } );

      } else {

        this.rotateCube( delta, () => {

          this.state = this.gettingDrag ? PREPARING : STILL;
          this.gettingDrag = false;

        } );

      }

    };

  }

  rotateLayer( rotation, scramble, callback ) {

    const config = scramble ? 0 : this.flipConfig;

    // Capture the layer for THIS rotation now. flipLayer is shared mutable state:
    // a concurrent scramble/restart can null it (via deselectLayer) before this
    // tween completes. Reading this.flipLayer in onComplete then threw null.slice(),
    // and that throw froze the whole animation loop (see AnimationEngine.update).
    const flipLayer = this.flipLayer;

    const easing = this.flipEasings[ config ];
    const duration = this.flipSpeeds[ config ];
    const bounce = ( config == 2 ) ? this.bounceCube() : ( () => {} );

    this.rotationTween = new Tween( {
      easing: easing,
      duration: duration,
      onUpdate: tween => {

        let deltaAngle = tween.delta * rotation;
        this.group.rotateOnAxis( this.flipAxis, deltaAngle );
        bounce( tween.value, deltaAngle, rotation );

      },
      onComplete: () => {

        if ( ! scramble ) this.onMove();

        // Superseded or aborted rotation: bail without touching shared state.
        if ( ! flipLayer ) return;

        const layer = flipLayer.slice( 0 );

        this.game.cube.object.rotation.setFromVector3( this.snapRotation( this.game.cube.object.rotation.toVector3() ) );
        this.group.rotation.setFromVector3( this.snapRotation( this.group.rotation.toVector3() ) );
        this.deselectLayer( flipLayer );

        callback( layer );

      },
    } );

  }

  bounceCube() {

    let fixDelta = true;

    return ( progress, delta, rotation ) => {

        if ( progress >= 1 ) {

          if ( fixDelta ) {

            delta = ( progress - 1 ) * rotation;
            fixDelta = false;

          }

          this.game.cube.object.rotateOnAxis( this.flipAxis, delta );

        }

    }

  }

  rotateCube( rotation, callback ) {

    const config = this.flipConfig;
    const easing = [ Easing.Power.Out( 4 ), Easing.Sine.Out(), Easing.Back.Out( 2 ) ][ config ];
    const duration = [ 100, 150, 350 ][ config ];

    this.rotationTween = new Tween( {
      easing: easing,
      duration: duration,
      onUpdate: tween => {

        this.edges.rotateOnWorldAxis( this.flipAxis, tween.delta * rotation );
        this.game.cube.object.rotation.copy( this.edges.rotation );

      },
      onComplete: () => {

        this.edges.rotation.setFromVector3( this.snapRotation( this.edges.rotation.toVector3() ) );
        this.game.cube.object.rotation.copy( this.edges.rotation );
        callback();

      },
    } );

  }

  selectLayer( layer ) {

    this.group.rotation.set( 0, 0, 0 );
    this.movePieces( layer, this.game.cube.object, this.group );
    this.flipLayer = layer;

  }

  deselectLayer( layer ) {

    this.movePieces( layer, this.group, this.game.cube.object );
    this.flipLayer = null;

  }

  movePieces( layer, from, to ) {

    from.updateMatrixWorld();
    to.updateMatrixWorld();

    layer.forEach( index => {

      const piece = this.game.cube.pieces[ index ];

      piece.applyMatrix( from.matrixWorld );
      from.remove( piece );
      piece.applyMatrix( new THREE.Matrix4().getInverse( to.matrixWorld ) );
      to.add( piece );

    } );

  }

  getLayer( position ) {

    const scalar = { 2: 6, 3: 3, 4: 4, 5: 3 }[ this.game.cube.size ];
    const layer = [];

    let axis;

    if ( position === false ) {

      const piece = this.dragIntersect.object.parent;

      axis = this.getMainAxis( this.flipAxis );
      position = piece.position.clone() .multiplyScalar( scalar ) .round();

    } else {

      axis = this.getMainAxis( position );

    }

    this.game.cube.pieces.forEach( piece => {

      const piecePosition = piece.position.clone().multiplyScalar( scalar ).round();

      if ( piecePosition[ axis ] == position[ axis ] ) layer.push( piece.name );

    } );

    return layer;

  }

  keyboardMove( type, move, callback ) {

    if ( this.state !== STILL ) return;
    if ( this.enabled !== true ) return;

    if ( type === 'LAYER' ) {

      const layer = this.getLayer( move.position );

      this.flipAxis = new THREE.Vector3();
      this.flipAxis[ move.axis ] = 1;
      this.state = ROTATING;

      this.selectLayer( layer );
      this.rotateLayer( move.angle, false, layer => {

        this.game.storage.saveGame();
        this.state = STILL;
        this.checkIsSolved();

      } );

    } else if ( type === 'CUBE' ) {

      this.flipAxis = new THREE.Vector3();
      this.flipAxis[ move.axis ] = 1;
      this.state = ROTATING;

      this.rotateCube( move.angle, () => {

        this.state = STILL;

      } );

    }

  }

  scrambleCube() {

    if ( this.scramble == null ) {

      this.scramble = this.game.scrambler;
      this.scrambleAborted = false;

    }

    if ( this.scrambleAborted ) {
      this.scramble = null;
      this.scrambleAborted = false;
      return;
    }

    const converted = this.scramble.converted;

    if ( ! converted || converted.length === 0 ) {
      this.scramble = null;
      this.game.storage.saveGame();
      return;
    }

    const move = converted[ 0 ];
    const layer = this.getLayer( move.position );

    this.flipAxis = new THREE.Vector3();
    this.flipAxis[ move.axis ] = 1;

    this.selectLayer( layer );
    this.rotateLayer( move.angle, true, () => {

      if ( this.scrambleAborted ) {
        this.scramble = null;
        this.scrambleAborted = false;
        return;
      }

      converted.shift();

      if ( converted.length > 0 ) {

        this.scrambleCube();

      } else {

        this.scramble = null;
        this.game.storage.saveGame();

      }

    } );

  }

  abortScramble() {
    this.scrambleAborted = true;
    this.scramble = null;
    // Kill any in-flight layer rotation so a stale chain can't keep running
    // (and complete) underneath the new scramble.
    try { this.rotationTween.stop(); } catch ( e ) {}

    // Tween.stop() skips onComplete, so pieces selected into the flip group
    // would otherwise stay there — visible as detached slices after a resize
    // or restart mid-scramble. Bake them back onto the cube object.
    this.releaseFlipGroup();
  }

  releaseFlipGroup() {

    if ( this.flipLayer ) {

      try {

        this.deselectLayer( this.flipLayer );

      } catch ( e ) {

        this.flipLayer = null;

      }

    }

    // Belt-and-suspenders for any stragglers without flipLayer bookkeeping.
    if ( this.group.children.length > 0 ) {

      this.group.updateMatrixWorld();
      this.game.cube.object.updateMatrixWorld();

      const stuck = this.group.children.slice();

      stuck.forEach( piece => {

        piece.applyMatrix( this.group.matrixWorld );
        this.group.remove( piece );
        piece.applyMatrix( new THREE.Matrix4().getInverse( this.game.cube.object.matrixWorld ) );
        this.game.cube.object.add( piece );

      } );

    }

    this.group.rotation.set( 0, 0, 0 );
    this.flipLayer = null;

  }

  getIntersect( position, object, multiple ) {

    this.raycaster.setFromCamera(
      this.draggable.convertPosition( position.clone() ),
      this.game.world.camera
    );

    const intersect = ( multiple )
      ? this.raycaster.intersectObjects( object )
      : this.raycaster.intersectObject( object );

    return ( intersect.length > 0 ) ? intersect[ 0 ] : false;

  }

  getMainAxis( vector ) {

    return Object.keys( vector ).reduce(
      ( a, b ) => Math.abs( vector[ a ] ) > Math.abs( vector[ b ] ) ? a : b
    );

  }

  detach( child, parent ) {

    child.applyMatrix( parent.matrixWorld );
    parent.remove( child );
    this.game.world.scene.add( child );

  }

  attach( child, parent ) {

    child.applyMatrix( new THREE.Matrix4().getInverse( parent.matrixWorld ) );
    this.game.world.scene.remove( child );
    parent.add( child );

  }

  addMomentumPoint( delta ) {

    const time = Date.now();

    this.momentum = this.momentum.filter( moment => time - moment.time < 500 );

    if ( delta !== false ) this.momentum.push( { delta, time } );

  }

  getMomentum() {

    const points = this.momentum.length;
    const momentum = new THREE.Vector2();

    this.addMomentumPoint( false );

    this.momentum.forEach( ( point, index ) => {

      momentum.add( point.delta.multiplyScalar( index / points ) );

    } );

    return momentum;

  }

  roundAngle( angle ) {

    const round = Math.PI / 2;
    return Math.sign( angle ) * Math.round( Math.abs( angle) / round ) * round;

  }

  snapRotation( angle ) {

    return angle.set(
      this.roundAngle( angle.x ),
      this.roundAngle( angle.y ),
      this.roundAngle( angle.z )
    );

  }

  checkIsSolved() {

    // Reuse the cube's local-frame face grouping (viewing-angle invariant) so a
    // solve registers no matter how the player has rotated their view. The old
    // world-space bucketing here only matched when the cube happened to sit at
    // an axis-aligned angle, so solves often went undetected.
    const sides = this.game.cube.getFaceGroups();

    let solved = true;

    Object.keys( sides ).forEach( side => {

      const faceEdges = sides[ side ];
      if ( faceEdges.length === 0 ) return;

      const firstColor = faceEdges[ 0 ].material.color.getHex();
      if ( ! faceEdges.every( edge => edge.material.color.getHex() === firstColor ) ) solved = false;

    } );

    if ( solved ) this.onSolved();

  }

}

class Scrambler {

  constructor( game ) {

    this.game = game;

    this.dificulty = 0;

    this.scrambleLength = {
      2: [ 7, 9, 11 ],
      3: [ 20, 25, 30 ],
      4: [ 30, 40, 50 ],
      5: [ 40, 60, 80 ],
    };

    this.moves = [];
    this.converted = [];
    this.print = '';

  }

  scramble( scramble ) {

    let count = 0;
    this.moves = ( typeof scramble !== 'undefined' ) ? scramble.split( ' ' ) : [];

    if ( this.moves.length < 1 ) {

      const scrambleLength = this.scrambleLength[ this.game.cube.size ][ this.dificulty ];

      const faces = this.game.cube.size < 4 ? 'UDLRFB' : 'UuDdLlRrFfBb';
      const modifiers = [ "", "'", "2" ];
      const total = ( typeof scramble === 'undefined' ) ? scrambleLength : scramble;

      while ( count < total ) {

        const move =
          faces[ Math.floor( Math.random() * faces.length ) ] +
          modifiers[ Math.floor( Math.random() * 3 ) ];

        if ( count > 0 && move.charAt( 0 ) == this.moves[ count - 1 ].charAt( 0 ) ) continue;
        if ( count > 1 && move.charAt( 0 ) == this.moves[ count - 2 ].charAt( 0 ) ) continue;

        this.moves.push( move );
        count ++;

      }

    }

    this.callback = () => {};
    this.convert();
    this.print = this.moves.join( ' ' );

    return this;

  }

  convert( moves ) {

    this.converted = [];

    this.moves.forEach( move => {

      const convertedMove = this.convertMove( move );
      const modifier = move.charAt( 1 );

      this.converted.push( convertedMove );
      if ( modifier == "2" ) this.converted.push( convertedMove );

    } );

  }

  convertMove( move ) {

    const face = move.charAt( 0 );
    const modifier = move.charAt( 1 );

    const axis = { D: 'y', U: 'y', L: 'x', R: 'x', F: 'z', B: 'z' }[ face.toUpperCase() ];
    let row = { D: -1, U: 1, L: -1, R: 1, F: 1, B: -1 }[ face.toUpperCase() ];

    if ( this.game.cube.size > 3 && face !== face.toLowerCase() ) row = row * 2;

    const position = new THREE.Vector3();
    position[ { D: 'y', U: 'y', L: 'x', R: 'x', F: 'z', B: 'z' }[ face.toUpperCase() ] ] = row;

    const angle = ( Math.PI / 2 ) * - row * ( ( modifier == "'" ) ? - 1 : 1 );

    return { position, axis, angle, name: move };

  }

}

class Transition {

  constructor( game ) {

    this.game = game;

    this.tweens = {};
    this.durations = {};
    this.data = {
      cubeY: -0.2,
      cameraZoom: 0.85,
    };

    this.activeTransitions = 0;

  }

  init() {

    this.game.controls.disable();

    this.game.cube.object.position.y = this.data.cubeY;
    this.game.cube.animator.position.y = 4;
    this.game.cube.animator.rotation.x = - Math.PI / 3;
    this.game.world.camera.zoom = this.data.cameraZoom;
    this.game.world.camera.updateProjectionMatrix();

    this.tweens.buttons = {};
    this.tweens.timer = [];
    this.tweens.title = [];
    this.tweens.best = [];
    this.tweens.complete = [];
    this.tweens.prefs = [];
    this.tweens.theme = [];
    this.tweens.stats = [];

  }

  buttons( show, hide ) {

    const buttonTween = ( button, show ) => {

      return new Tween( {
        target: button.style,
        duration: 300,
        easing: show ? Easing.Power.Out( 2 ) : Easing.Power.In( 3 ),
        from: { opacity: show ? 0 : 1 },
        to: { opacity: show ? 1 : 0 },
        onUpdate: tween => {

          const translate = show ? 1 - tween.value : tween.value;
          button.style.transform = `translate3d(0, ${translate * 1.5}em, 0)`;

        },
        onComplete: () => button.style.pointerEvents = show ? 'all' : 'none'
      } );

    };

    hide.forEach( button =>
      this.tweens.buttons[ button ] = buttonTween( this.game.dom.buttons[ button ], false )
    );

    setTimeout( () => show.forEach( button => {

      this.tweens.buttons[ button ] = buttonTween( this.game.dom.buttons[ button ], true );

    } ), hide ? 500 : 0 );

  }

  cube( show, theming = false ) {

    // Block cube transitions while scramble is in progress or position is locked.
    // Don't silently abandon a SHOW: a swallowed bring-back used to strand the cube
    // offscreen (it had flown up via a prior HIDE and never came back). Snap it to
    // its resting position instead, so a blocked SHOW always lands centered.
    if ( this.scrambleInProgress || this.cubePositionLocked ) {
      if ( show ) {
        this.game.cube.animator.position.y = theming ? 0.9 : 0;
        this.game.cube.animator.rotation.x = 0;
      }
      return;
    }

    this.activeTransitions++;

    try { this.tweens.cube.stop(); } catch(e) {}
    const currentY = this.game.cube.animator.position.y;
    const currentRotation = this.game.cube.animator.rotation.x;

    // Create reference to this for closure
    const transition = this;

    this.tweens.cube = new Tween( {
      duration: show ? 3000 : 1250,
      easing: show ? Easing.Elastic.Out( 0.8, 0.6 ) : Easing.Back.In( 1 ),
      onUpdate: tween => {

        // Check if cube position is locked (scramble button was clicked)
        if ( transition.cubePositionLocked ) return;

        this.game.cube.animator.position.y = show
          ? ( theming ? 0.9 + ( 1 - tween.value ) * 3.5 : ( 1 - tween.value ) * 4 )
          : currentY + tween.value * 4;

        this.game.cube.animator.rotation.x = show
          ? ( 1 - tween.value ) * Math.PI / 3
          : currentRotation + tween.value * - Math.PI / 3;

      },
    } );

    if ( theming ) {

      if ( show ) {

        this.game.world.camera.zoom = 0.75;
        this.game.world.camera.updateProjectionMatrix();

      } else {

        setTimeout( () => {

          this.game.world.camera.zoom = this.data.cameraZoom;
          this.game.world.camera.updateProjectionMatrix();

        }, 1500 );

      }

    }

    this.durations.cube = show ? 1500 : 1500;

    setTimeout( () => { if ( this.activeTransitions > 0 ) this.activeTransitions--; }, this.durations.cube );

  }

  float() {

    try { this.tweens.float.stop(); } catch(e) {}
    this.tweens.float = new Tween( {
      duration: 1500,
      easing: Easing.Sine.InOut(),
      yoyo: true,
      onUpdate: tween => {

        this.game.cube.holder.position.y = (- 0.02 + tween.value * 0.04); 
        this.game.cube.holder.rotation.x = 0.005 - tween.value * 0.01;
        this.game.cube.holder.rotation.z = - this.game.cube.holder.rotation.x;
        this.game.cube.holder.rotation.y = this.game.cube.holder.rotation.x;

        this.game.controls.edges.position.y =
          this.game.cube.holder.position.y + this.game.cube.object.position.y;

      },
    } );

  }

  zoom( play, time ) {

    // Block zoom transitions while scramble is in progress
    if ( this.scrambleInProgress ) return;

    this.activeTransitions++;

    const zoom = ( play ) ? 1 : this.data.cameraZoom;
    const duration = ( time > 0 ) ? Math.max( time, 1500 ) : 1500;
    const rotations = ( time > 0 ) ? Math.round( duration / 1500 ) : 1;
    const easing = Easing.Power.InOut( ( time > 0 ) ? 2 : 3 );

    this.tweens.zoom = new Tween( {
      target: this.game.world.camera,
      duration: duration,
      easing: easing,
      to: { zoom: zoom },
      onUpdate: () => { this.game.world.camera.updateProjectionMatrix(); },
    } );

    this.tweens.rotate = new Tween( {
      target: this.game.cube.animator.rotation,
      duration: duration,
      easing: easing,
      to: { y: - Math.PI * 2 * rotations },
      onComplete: () => { this.game.cube.animator.rotation.y = 0; },
    } );

    this.durations.zoom = duration;

    setTimeout( () => { if ( this.activeTransitions > 0 ) this.activeTransitions--; }, this.durations.zoom );

  }

  elevate( complete ) {

    this.activeTransitions++;

    this.tweens.elevate = new Tween( {
      target: this.game.cube.object.position,
      duration: complete ? 1500 : 0,
      easing: Easing.Power.InOut( 3 ),
      to: { y: complete ? -0.05 : this.data.cubeY }
    } );

    this.durations.elevate = 1500;

    setTimeout( () => { if ( this.activeTransitions > 0 ) this.activeTransitions--; }, this.durations.elevate );

  }

  complete( show, best ) {

    this.activeTransitions++;

    const text = best ? this.game.dom.texts.best : this.game.dom.texts.complete;

    if ( text.querySelector( 'span i' ) === null )
      text.querySelectorAll( 'span' ).forEach( span => this.splitLetters( span ) );

    const letters = text.querySelectorAll( '.icon, i' );

    this.flipLetters( best ? 'best' : 'complete', letters, show );

    text.style.opacity = 1;

    const duration = this.durations[ best ? 'best' : 'complete' ];

    if ( ! show ) setTimeout( () => this.game.dom.texts.timer.style.transform = '', duration );

    setTimeout( () => { if ( this.activeTransitions > 0 ) this.activeTransitions--; }, duration );

  } 

  stats( show ) {

    // Panel content is the scoreboard now; fade the whole overlay in/out.
    if ( show ) this.game.renderScoreboard();

    this.activeTransitions++;
    this.game.boardOpen = show;

    const panel = this.game.dom.stats;
    if ( show ) {
      panel.classList.add( 'is-open' );
      panel.setAttribute( 'aria-hidden', 'false' );
      panel.style.pointerEvents = 'all';
      panel.inert = false;
      this.game.dom.ui.classList.add( 'board-open' );
      this.game.setBehindBoard( true );
      if ( this.game.dom.scoreboardClose ) this.game.dom.scoreboardClose.focus();
    }

    try { this.tweens.statsPanel.stop(); } catch ( e ) {}

    this.tweens.statsPanel = new Tween( {
      duration: 400,
      easing: show ? Easing.Power.Out( 2 ) : Easing.Power.In( 2 ),
      onUpdate: tween => {

        panel.style.opacity = show ? tween.value : ( 1 - tween.value );

      },
      onComplete: () => {

        if ( ! show ) {
          panel.classList.remove( 'is-open' );
          panel.setAttribute( 'aria-hidden', 'true' );
          panel.style.pointerEvents = 'none';
          panel.inert = true;
          this.game.dom.ui.classList.remove( 'board-open' );
          this.game.setBehindBoard( false );
          this.game.dom.buttons.stats.focus();
        }

      },
    } );

    this.durations.stats = 400;

    setTimeout( () => { if ( this.activeTransitions > 0 ) this.activeTransitions--; }, this.durations.stats );

  }

  preferences( show ) {

    this.ranges( this.game.dom.prefs.querySelectorAll( '.range' ), 'prefs', show );

  }

  theming( show ) {

    this.ranges( this.game.dom.theme.querySelectorAll( '.range' ), 'prefs', show );

  }

  ranges( ranges, type, show ) {

    this.activeTransitions++;

    this.tweens[ type ].forEach( tween => { tween.stop(); tween = null; } );

    const easing = show ? Easing.Power.Out(2) : Easing.Power.In(3);

    let tweenId = -1;
    let listMax = 0;

    ranges.forEach( ( range, rangeIndex ) => {
    
      const label = range.querySelector( '.range__label' );
      const track = range.querySelector( '.range__track-line' );
      const handle = range.querySelector( '.range__handle' );
      const list = range.querySelectorAll( '.range__list div' );

      const delay = rangeIndex * ( show ? 120 : 100 );

      label.style.opacity = show ? 0 : 1;
      track.style.opacity = show ? 0 : 1;
      handle.style.opacity = show ? 0 : 1;
      handle.style.pointerEvents = show ? 'all' : 'none';

      this.tweens[ type ][ tweenId++ ] = new Tween( {
        delay: show ? delay : delay,
        duration: 400,
        easing: easing,
        onUpdate: tween => {

          const translate = show ? ( 1 - tween.value ) : tween.value;
          const opacity = show ? tween.value : ( 1 - tween.value );

          label.style.transform = `translate3d(0, ${translate}em, 0)`;
          label.style.opacity = opacity;

        }
      } );

      this.tweens[ type ][ tweenId++ ] = new Tween( {
        delay: show ? delay + 100 : delay,
        duration: 400,
        easing: easing,
        onUpdate: tween => {

          const translate = show ? ( 1 - tween.value ) : tween.value;
          const scale = show ? tween.value : ( 1 - tween.value );
          const opacity = scale;

          track.style.transform = `translate3d(0, ${translate}em, 0) scale3d(${scale}, 1, 1)`;
          track.style.opacity = opacity;

        }
      } );

      this.tweens[ type ][ tweenId++ ] = new Tween( {
        delay: show ? delay + 100 : delay,
        duration: 400,
        easing: easing,
        onUpdate: tween => {

          const translate = show ? ( 1 - tween.value ) : tween.value;
          const opacity = 1 - translate;
          const scale = 0.5 + opacity * 0.5;

          handle.style.transform = `translate3d(0, ${translate}em, 0) scale3d(${scale}, ${scale}, ${scale})`;
          handle.style.opacity = opacity;

        }
      } );

      list.forEach( ( listItem, labelIndex ) => {

        listItem.style.opacity = show ? 0 : 1;

        this.tweens[ type ][ tweenId++ ] = new Tween( {
          delay: show ? delay + 200 + labelIndex * 50 : delay,
          duration: 400,
          easing: easing,
          onUpdate: tween => {

            const translate = show ? ( 1 - tween.value ) : tween.value;
            const opacity = show ? tween.value : ( 1 - tween.value );

            listItem.style.transform = `translate3d(0, ${translate}em, 0)`;
            listItem.style.opacity = opacity;

          }
        } );

      } );

      listMax = list.length > listMax ? list.length - 1 : listMax;

      range.style.opacity = 1;

    } );

    this.durations[ type ] = show
      ? ( ( ranges.length - 1 ) * 100 ) + 200 + listMax * 50 + 400
      : ( ( ranges.length - 1 ) * 100 ) + 400;

    setTimeout( () => { if ( this.activeTransitions > 0 ) this.activeTransitions--; }, this.durations[ type ] ); 

  }

  title( show ) {

    // Block title transitions while scramble is in progress (shouldn't show title during gameplay)
    if ( this.scrambleInProgress && show ) return;

    this.activeTransitions++;

    const title = this.game.dom.texts.title;

    if ( title.querySelector( 'span i' ) === null )
      title.querySelectorAll( 'span' ).forEach( span => this.splitLetters( span ) );

    const letters = title.querySelectorAll( 'i' );

    this.flipLetters( 'title', letters, show );

    title.style.opacity = 1;

    const note = this.game.dom.texts.note;

    // "Tap to begin" is only true, and only visible, while the title is up.
    note.setAttribute( 'aria-hidden', show ? 'false' : 'true' );

    this.tweens.title[ letters.length ] = new Tween( {
      target: note.style,
      easing: Easing.Sine.InOut(),
      duration: show ? 800 : 400,
      yoyo: show ? true : null,
      from: { opacity: show ? 0 : ( parseFloat( getComputedStyle( note ).opacity ) ) },
      to: { opacity: show ? 1 : 0 },
    } );

    setTimeout( () => { if ( this.activeTransitions > 0 ) this.activeTransitions--; }, this.durations.title );

  }

  timer( show ) {

    this.activeTransitions++;

    const timer = this.game.dom.texts.timer;

    timer.style.opacity = 0;
    this.game.timer.convert();
    this.game.timer.setText();

    this.splitLetters( timer );
    const letters = timer.querySelectorAll( 'i' );
    this.flipLetters( 'timer', letters, show );

    timer.style.opacity = 1;

    setTimeout( () => { if ( this.activeTransitions > 0 ) this.activeTransitions--; }, this.durations.timer );

  }

  splitLetters( element ) {

    const text = element.innerHTML;

    element.innerHTML = '';

    text.split( '' ).forEach( letter => {

      const i = document.createElement( 'i' );

      i.innerHTML = letter;
      i.setAttribute( 'aria-hidden', 'true' );

      element.appendChild( i );

    } );

  }

  flipLetters( type, letters, show ) {

    try { this.tweens[ type ].forEach( tween => tween.stop() ); } catch(e) {}
    letters.forEach( ( letter, index ) => {

      letter.style.opacity = show ? 0 : 1;

      this.tweens[ type ][ index ] = new Tween( {
        easing: Easing.Sine.Out(),
        duration: show ? 800 : 400,
        delay: index * 50,
        onUpdate: tween => {

          const rotation = show ? ( 1 - tween.value ) * -80 : tween.value * 80;

          letter.style.transform = `rotate3d(0, 1, 0, ${rotation}deg)`;
          letter.style.opacity = show ? tween.value : ( 1 - tween.value );

        },
      } );

    } );

    this.durations[ type ] = ( letters.length - 1 ) * 50 + ( show ? 800 : 400 );

  }

}

class Timer extends Animation {

  constructor( game ) {

    super( false );

    this.game = game;
    this.reset();
    
    // Fun message system
    this.idleMessages = [
      'hello',
      'anyone there?',
      '...waiting...',
      '*taps cube*',
      'the cube awaits',
      'feeling shy?',
      'poke me!',
      'i won\'t bite',
      'ready when u are',
      '*whistles*'
    ];
    
    this.progressMessages = {
      cold: [ 'coooolder', 'brr...', 'wrong way?', 'oof', 'try again', 'hmm...' ],
      warm: [ 'getting there', 'warmer...', 'keep going', 'not bad', 'on track' ],
      hot: [ 'yesss nice!', 'ooh!', 'so close!', 'almost!', 'YES!', 'nice move!' ]
    };
    
    this.idleMessageIndex = 0;
    this.lastIdleCheck = 0;
    this.showingMessage = false;
    this.lastProgressCheck = 0;
    this.lastCompletedFaces = 0;
    
    // Start idle checker
    this.startIdleChecker();
  }

  start( continueGame ) {

    if ( this.idleCheckerId ) {
      clearInterval( this.idleCheckerId );
      this.idleCheckerId = null;
    }

    this.startTime = continueGame ? ( Date.now() - this.deltaTime ) : Date.now();
    this.deltaTime = 0;
    this.converted = this.convert();
    this.showingMessage = false;

    super.start();

  }

  reset() {

    this.startTime = 0;
    this.currentTime = 0;
    this.deltaTime = 0;
    this.converted = '0:00';
    this.idleMessageIndex = 0;
    this.showingMessage = false;
    this.lastCompletedFaces = 0;

  }

  stop() {

    this.currentTime = Date.now();
    this.deltaTime = this.currentTime - this.startTime;
    this.convert();

    super.stop();

    return { time: this.converted, millis: this.deltaTime };

  }

  update() {

    const old = this.converted;

    this.currentTime = Date.now();
    this.deltaTime = this.currentTime - this.startTime;
    this.convert();

    if ( this.converted != old ) {

      localStorage.setItem( 'theCube_time', this.deltaTime );
      if ( !this.showingMessage ) {
        this.setText();
      }

    }

  }

  convert() {

    this.converted = formatTime( this.deltaTime ) || '0:00';

  }

  setText() {

    this.show( this.converted );

  }

  // Everything the timer line shows goes through here, so a screen reader
  // gets the same words as one label instead of letter by letter.
  show( text ) {

    const timer = this.game.dom.texts.timer;
    timer.innerHTML = text;
    timer.setAttribute( 'aria-label', text );

  }
  
  // Show a fun message temporarily instead of time
  showMessage( message, duration = 1500 ) {
    this.showingMessage = true;
    this.show( message );
    
    setTimeout( () => {
      this.showingMessage = false;
      this.setText();
    }, duration );
  }
  
  // Show idle message when waiting at 0:00
  showIdleMessage() {
    if ( !this.game.newGame ) return; // Only show when waiting for first move
    if ( this.showingMessage ) return;
    
    const message = this.idleMessages[ this.idleMessageIndex ];
    this.idleMessageIndex = ( this.idleMessageIndex + 1 ) % this.idleMessages.length;
    
    this.showingMessage = true;
    this.show( message );
    
    setTimeout( () => {
      this.showingMessage = false;
      if ( this.game.newGame ) {
        this.show( '0:00' );
      }
    }, 2500 );
  }
  
  // Start idle message checker
  startIdleChecker() {
    if ( this.idleCheckerId ) clearInterval( this.idleCheckerId );
    this.idleCheckerId = setInterval( () => {
      if ( this.game.newGame && !this.showingMessage ) {
        const now = Date.now();
        if ( now - this.lastIdleCheck > 5000 + Math.random() * 5000 ) {
          this.lastIdleCheck = now;
          this.showIdleMessage();
        }
      }
    }, 1000 );
  }
  
  // Check progress and maybe show a fun comment
  checkProgress() {
    if ( !this.game.cube || !this.game.cube.edges ) return;
    if ( this.showingMessage ) return;
    
    // Count completed faces
    const faces = [ 'U', 'D', 'F', 'B', 'L', 'R' ];
    const size = this.game.cube.size;
    let completedFaces = 0;
    
    faces.forEach( faceName => {
      const faceEdges = this.game.cube.edges.filter( edge => edge.name === faceName );
      if ( faceEdges.length === size * size ) {
        const colors = faceEdges.map( edge => edge.material.color.getHex() );
        const firstColor = colors[0];
        if ( colors.every( c => c === firstColor ) ) {
          completedFaces++;
        }
      }
    });
    
    // Decide if we should show a message (20% chance on change)
    if ( Math.random() > 0.2 ) return;
    
    let category;
    if ( completedFaces > this.lastCompletedFaces ) {
      // Progress! Show a warm/hot message
      category = completedFaces >= 3 ? 'hot' : 'warm';
    } else if ( completedFaces < this.lastCompletedFaces ) {
      // Went backwards
      category = 'cold';
    } else {
      return; // No change
    }
    
    this.lastCompletedFaces = completedFaces;
    
    const messages = this.progressMessages[ category ];
    const message = messages[ Math.floor( Math.random() * messages.length ) ];
    this.showMessage( message, 1200 );
  }

}

const RangeHTML = [

  '<div class="range">',
    '<div class="range__label"></div>',
    '<div class="range__track">',
      '<div class="range__track-line"></div>',
      '<div class="range__handle"><div></div></div>',
    '</div>',
    '<div class="range__list"></div>',
  '</div>',

].join( '\n' );

document.querySelectorAll( 'range' ).forEach( el => {

  const temp = document.createElement( 'div' );
  temp.innerHTML = RangeHTML;

  const range = temp.querySelector( '.range' );
  const rangeLabel = range.querySelector( '.range__label' );
  const rangeList = range.querySelector( '.range__list' );

  range.setAttribute( 'name', el.getAttribute( 'name' ) );
  rangeLabel.innerHTML = el.getAttribute( 'title' );

  if ( el.hasAttribute( 'color' ) ) {

    range.classList.add( 'range--type-color' );
    range.classList.add( 'range--color-' + el.getAttribute( 'name' ) );

  }

  if ( el.hasAttribute( 'list' ) ) {

    el.getAttribute( 'list' ).split( ',' ).forEach( listItemText => {

      const listItem = document.createElement( 'div' );
      listItem.innerHTML = listItemText;
      rangeList.appendChild( listItem );

    } );

  }

  el.parentNode.replaceChild( range, el );

} );

class Range {

  constructor( name, options ) {

    options = Object.assign( {
      range: [ 0, 1 ],
      value: 0,
      step: 0,
      onUpdate: () => {},
      onComplete: () => {},
    }, options || {} );

    this.element = document.querySelector( '.range[name="' + name + '"]' );
    this.track = this.element.querySelector( '.range__track' );
    this.handle = this.element.querySelector( '.range__handle' );
    this.list = [].slice.call( this.element.querySelectorAll( '.range__list div' ) );

    this.value = options.value;
    this.min = options.range[0];
    this.max = options.range[1];
    this.step = options.step;

    this.onUpdate = options.onUpdate;
    this.onComplete = options.onComplete;

    this.setValue( this.value );

    this.initDraggable();

  }

  setValue( value ) {

    this.value = this.round( this.limitValue( value ) );
    this.setHandlePosition();

  }

  initDraggable() {

    let current;

    this.draggable = new Draggable( this.handle, { calcDelta: true } );

    this.draggable.onDragStart = position => {

      current = this.positionFromValue( this.value );
      this.handle.style.left = current + 'px';

    };

    this.draggable.onDragMove = position => {

      current = this.limitPosition( current + position.delta.x );
      this.value = this.round( this.valueFromPosition( current ) );
      this.setHandlePosition();
      
      this.onUpdate( this.value );

    };

    this.draggable.onDragEnd = position => {

      this.onComplete( this.value );

    };

  }

  round( value ) {

    if ( this.step < 1 ) return value;

    return Math.round( ( value - this.min ) / this.step ) * this.step + this.min;

  }

  limitValue( value ) {

    const max = Math.max( this.max, this.min );
    const min = Math.min( this.max, this.min );

    return Math.min( Math.max( value, min ), max );

  }

  limitPosition( position ) {

    return Math.min( Math.max( position, 0 ), this.track.offsetWidth );

  }

  percentsFromValue( value ) {

    return ( value - this.min ) / ( this.max - this.min );

  }

  valueFromPosition( position ) {

    return this.min + ( this.max - this.min ) * ( position / this.track.offsetWidth );

  }

  positionFromValue( value ) {

    return this.percentsFromValue( value ) * this.track.offsetWidth;

  }

  setHandlePosition() {

    this.handle.style.left = this.percentsFromValue( this.value ) * 100 + '%';

  }

}

class Preferences {

  constructor( game ) {

    this.game = game;

  }

  init() {

    this.ranges = {

      size: new Range( 'size', {
        value: this.game.cube.size,
        range: [ 2, 5 ],
        step: 1,
        onUpdate: value => {

          this.game.cube.size = value;

          this.game.preferences.ranges.scramble.list.forEach( ( item, i ) => {

            item.innerHTML = this.game.scrambler.scrambleLength[ this.game.cube.size ][ i ];

          } );

        },
        onComplete: () => this.game.storage.savePreferences(),
      } ),

      flip: new Range( 'flip', {
        value: this.game.controls.flipConfig,
        range: [ 0, 2 ],
        step: 1,
        onUpdate: value => {

          this.game.controls.flipConfig = value;

        },
        onComplete: () => this.game.storage.savePreferences(),
      } ),

      scramble: new Range( 'scramble', {
        value: this.game.scrambler.dificulty,
        range: [ 0, 2 ],
        step: 1,
        onUpdate: value => {

          this.game.scrambler.dificulty = value;

        },
        onComplete: () => this.game.storage.savePreferences()
      } ),

      fov: new Range( 'fov', {
        value: this.game.world.fov,
        range: [ 2, 45 ],
        onUpdate: value => {

          this.game.world.fov = value;
          this.game.world.resize();

        },
        onComplete: () => this.game.storage.savePreferences()
      } ),

      theme: new Range( 'theme', {
        value: { vivid: 0, sunset: 1, ocean: 2, neon: 3, pastel: 4 }[ this.game.themes.theme ],
        range: [ 0, 4 ],
        step: 1,
        onUpdate: value => {

          const theme = [ 'vivid', 'sunset', 'ocean', 'neon', 'pastel' ][ value ];
          this.game.themes.setTheme( theme );

        },
        onComplete: () => this.game.storage.savePreferences()
      } ),

    };

    this.ranges.scramble.list.forEach( ( item, i ) => {

      item.innerHTML = this.game.scrambler.scrambleLength[ this.game.cube.size ][ i ];

    } );
    
  }

}

class Confetti {

  constructor( game ) {

    this.game = game;
    this.started = 0;

    this.options = {
      speed: { min: 0.0011, max: 0.0022 },
      revolution: { min: 0.01, max: 0.05 },
      size: { min: 0.1, max: 0.15 },
      colors: [ 0x42d4f4, 0xf032e6, 0xffe119, 0xf58231, 0x000075 ], // CB-friendly
    };

    this.geometry = new THREE.PlaneGeometry( 1, 1 );
    this.material = new THREE.MeshLambertMaterial( { side: THREE.DoubleSide } );

    this.holders = [
      new ConfettiStage( this.game, this, 1, 20 ),
      new ConfettiStage( this.game, this, -1, 30 ),
    ];

  }

  start() {

    if ( this.started > 0 ) return;

    this.holders.forEach( holder => {

      this.game.world.scene.add( holder.holder );
      holder.start();
      this.started ++;

    } );

  }

  stop() {

    if ( this.started == 0 ) return;

    this.holders.forEach( holder => {

      holder.stop( () => {

        this.game.world.scene.remove( holder.holder );
        this.started --;

      } );

    } );

  }

  updateColors( colors ) {

    this.holders.forEach( holder => {

      holder.options.colors.forEach( ( color, index ) => {

        holder.options.colors[ index ] = colors[ [ 'D', 'F', 'R', 'B', 'L' ][ index ] ];

      } );

    } );

  }

}

class ConfettiStage extends Animation {

  constructor( game, parent, distance, count ) {

    super( false );

    this.game = game;
    this.parent = parent;

    this.distanceFromCube = distance;

    this.count = count;
    this.particles = [];

    this.holder = new THREE.Object3D();
    this.holder.rotation.copy( this.game.world.camera.rotation );

    this.object = new THREE.Object3D();
    this.holder.add( this.object );

    this.resizeViewport = this.resizeViewport.bind( this );
    this.game.world.onResize.push( this.resizeViewport );
    this.resizeViewport();    

    this.geometry = this.parent.geometry;
    this.material = this.parent.material;

    this.options = this.parent.options;

    let i = this.count;
    while ( i-- ) this.particles.push( new Particle( this ) );

  }

  start() {

    this.time = performance.now();
    this.playing = true;

    let i = this.count;
    while ( i-- ) this.particles[ i ].reset();

    super.start();

  }

  stop( callback ) {

    this.playing = false;
    this.completed = 0;
    this.callback = callback;

  }

  reset() {

    super.stop();

    this.callback();

  }

  update() {

    const now = performance.now();
    const delta = now - this.time;
    this.time = now;

    let i = this.count;

    while ( i-- )
      if ( ! this.particles[ i ].completed ) this.particles[ i ].update( delta );

    if ( ! this.playing && this.completed == this.count ) this.reset();

  }

  resizeViewport() {

    const fovRad = this.game.world.camera.fov * THREE.Math.DEG2RAD;

    this.height = 2 * Math.tan( fovRad / 2 ) * ( this.game.world.camera.position.length() - this.distanceFromCube );
    this.width = this.height * this.game.world.camera.aspect;

    const scale = 1 / this.game.transition.data.cameraZoom;

    this.width *= scale;
    this.height *= scale;

    this.object.position.z = this.distanceFromCube;
    this.object.position.y = this.height / 2;

  }
  
}

class Particle {

  constructor( confetti ) {

    this.confetti = confetti;
    this.options = this.confetti.options;

    this.velocity = new THREE.Vector3();
    this.force = new THREE.Vector3();

    this.mesh = new THREE.Mesh( this.confetti.geometry, this.confetti.material.clone() );
    this.confetti.object.add( this.mesh );

    this.size = THREE.Math.randFloat( this.options.size.min, this.options.size.max );
    this.mesh.scale.set( this.size, this.size, this.size );

    return this;

  }

  reset( randomHeight = true ) {

    this.completed = false;

    this.color = new THREE.Color( this.options.colors[ Math.floor( Math.random() * this.options.colors.length ) ] );
    this.mesh.material.color.set( this.color );

    this.speed = THREE.Math.randFloat( this.options.speed.min, this.options.speed.max ) * - 1;
    this.mesh.position.x = THREE.Math.randFloat( - this.confetti.width / 2, this.confetti.width / 2 );
    this.mesh.position.y = ( randomHeight )
      ? THREE.Math.randFloat( this.size, this.confetti.height + this.size )
      : this.size;

    this.revolutionSpeed = THREE.Math.randFloat( this.options.revolution.min, this.options.revolution.max );
    this.revolutionAxis = [ 'x', 'y', 'z' ][ Math.floor( Math.random() * 3 ) ];
    this.mesh.rotation.set( Math.random() * Math.PI / 3, Math.random() * Math.PI / 3, Math.random() * Math.PI / 3 );

  }

  stop() {

    this.completed = true;
    this.confetti.completed ++;

  }

  update( delta ) {

    this.mesh.position.y += this.speed * delta;
    this.mesh.rotation[ this.revolutionAxis ] += this.revolutionSpeed;

    if ( this.mesh.position.y < - this.confetti.height - this.size )
      ( this.confetti.playing ) ? this.reset( false ) : this.stop();

  }

}

class Scores {

  constructor( game ) {

    this.game = game;

    this.data = {
      2: {
        scores: [],
        solves: 0,
        best: 0,
        worst: 0,
      },
      3: {
        scores: [],
        solves: 0,
        best: 0,
        worst: 0,
      },
      4: {
        scores: [],
        solves: 0,
        best: 0,
        worst: 0,
      },
      5: {
        scores: [],
        solves: 0,
        best: 0,
        worst: 0,
      }
    };

  }

  addScore( time ) {

    const data = this.data[ this.game.cube.sizeGenerated ];

    data.scores.push( time );
    data.solves++;

    if ( data.scores.length > 100 ) data.scores.shift();

    let bestTime = false;    

    if ( time < data.best || data.best === 0 ) {

      data.best = time;
      bestTime = true;

    }

    if ( time > data.worst ) data.worst = time;

    this.game.storage.saveScores();

    return bestTime;

  }

  calcStats() {

    const s = this.game.cube.sizeGenerated;
    const data = this.data[ s ];

    this.setStat( 'cube-size', `${s}<i>x</i>${s}<i>x</i>${s}` );
    this.setStat( 'total-solves', data.solves );
    this.setStat( 'best-time', this.convertTime( data.best ) );
    this.setStat( 'worst-time', this.convertTime( data.worst ) );
    this.setStat( 'average-5', this.getAverage( 5 ) );
    this.setStat( 'average-12', this.getAverage( 12 ) );
    this.setStat( 'average-25', this.getAverage( 25 ) );

  }

  setStat( name, value ) {

    if ( value === 0 ) value = '-';

    // The .ui__stats panel is the scoreboard now; the old per-stat rows are gone.
    const el = this.game.dom.stats.querySelector( `.stats[name="${name}"] b` );
    if ( el ) el.innerHTML = value;

  }

  getAverage( count ) {

    const data = this.data[ this.game.cube.sizeGenerated ];

    if ( data.scores.length < count ) return 0;

    return this.convertTime( data.scores.slice( -count ).reduce( ( a, b ) => a + b, 0 ) / count );

  }

  convertTime( time ) {

    return formatTime( time );

  }

}

class Storage {

  constructor( game ) {

    this.game = game;

    const userVersion = localStorage.getItem( 'theCube_version' );

    if ( ! userVersion || userVersion !== window.gameVersion ) {

      this.clearGame();
      this.clearPreferences();
      this.migrateScores();
      localStorage.setItem( 'theCube_version', window.gameVersion );

    }

  }

  init() {

    this.loadPreferences();
    this.loadScores();

  }

  loadGame() {

    try {

      const gameInProgress = localStorage.getItem( 'theCube_playing' ) === 'true';

      if ( ! gameInProgress ) throw new Error();

      const gameCubeData = JSON.parse( localStorage.getItem( 'theCube_savedState' ) );
      const gameTime = parseInt( localStorage.getItem( 'theCube_time' ) );

      if ( ! gameCubeData || gameTime === null ) throw new Error();
      if ( gameCubeData.size !== this.game.cube.sizeGenerated ) throw new Error();

      this.game.cube.loadFromData( gameCubeData );

      this.game.timer.deltaTime = gameTime;

      this.game.saved = true;

    } catch( e ) {

      this.game.saved = false;

    }

  }

  saveGame() {

    const gameInProgress = true;
    const gameCubeData = { names: [], positions: [], rotations: [] };
    const gameTime = this.game.timer.deltaTime;

    gameCubeData.size = this.game.cube.sizeGenerated;

    this.game.cube.pieces.forEach( piece => {

      gameCubeData.names.push( piece.name );
      gameCubeData.positions.push( piece.position );
      gameCubeData.rotations.push( piece.rotation.toVector3() );

    } );

    localStorage.setItem( 'theCube_playing', gameInProgress );
    localStorage.setItem( 'theCube_savedState', JSON.stringify( gameCubeData ) );
    localStorage.setItem( 'theCube_time', gameTime );

  }

  clearGame() {

    localStorage.removeItem( 'theCube_playing' );
    localStorage.removeItem( 'theCube_savedState' );
    localStorage.removeItem( 'theCube_time' );

  }

  loadScores() {

    try {

      const scoresData = JSON.parse( localStorage.getItem( 'theCube_scores' ) );

      if ( ! scoresData ) throw new Error();

      this.game.scores.data = scoresData;

    } catch( e ) {}

  }

  saveScores() {

    const scoresData = this.game.scores.data;

    localStorage.setItem( 'theCube_scores', JSON.stringify( scoresData ) );

  }

  clearScores() {

    localStorage.removeItem( 'theCube_scores' );

  }

  migrateScores() {

    try {

      const scoresData = JSON.parse( localStorage.getItem( 'theCube_scoresData' ) );
      const scoresBest = parseInt( localStorage.getItem( 'theCube_scoresBest' ) );
      const scoresWorst = parseInt( localStorage.getItem( 'theCube_scoresWorst' ) );
      const scoresSolves = parseInt( localStorage.getItem( 'theCube_scoresSolves' ) );

      if ( ! scoresData || ! scoresBest || ! scoresSolves || ! scoresWorst ) return false;

      this.game.scores.data[ 3 ].scores = scoresData;
      this.game.scores.data[ 3 ].best = scoresBest;
      this.game.scores.data[ 3 ].solves = scoresSolves;
      this.game.scores.data[ 3 ].worst = scoresWorst;

      localStorage.removeItem( 'theCube_scoresData' );
      localStorage.removeItem( 'theCube_scoresBest' );
      localStorage.removeItem( 'theCube_scoresWorst' );
      localStorage.removeItem( 'theCube_scoresSolves' );

    } catch( e ) {}

  }

  loadPreferences() {

    try {

      const preferences = JSON.parse( localStorage.getItem( 'theCube_preferences' ) );

      if ( ! preferences ) throw new Error();

      // PROGRESSION MODE: Always start at 2x2, ignore saved cube size
      this.game.cube.size = 2;
      this.game.controls.flipConfig = parseInt( preferences.flipConfig );
      this.game.scrambler.dificulty = parseInt( preferences.dificulty );

      this.game.world.fov = parseFloat( preferences.fov );
      this.game.world.resize();

      // Validate saved theme and colors before applying
      const theme = preferences.theme;
      const colors = preferences.colors;
      const themeList = this.game.themes.themeList;
      const CURRENT_COLOR_VERSION = 11; // Must match savePreferences

      // Check if color version matches - if not, reset to new defaults
      if ( preferences.colorVersion !== CURRENT_COLOR_VERSION ) {
        // Refresh palette values while preserving a valid selected theme.
        this.game.themes.colors = JSON.parse( JSON.stringify( this.game.themes.defaults ) );
        this.game.themes.setTheme( theme && themeList.includes( theme ) ? theme : 'vivid' );
        this.savePreferences(); // Save with new version
      } else if ( theme && themeList.includes( theme ) && colors && colors[ theme ] && colors[ theme ].R !== undefined ) {
        this.game.themes.colors = colors;
        this.game.themes.setTheme( theme );
      } else {
        // Invalid or corrupted preferences, use defaults
        this.game.themes.setTheme( 'vivid' );
      }

      return true;

    } catch (e) {

      this.game.cube.size = 2;
      this.game.controls.flipConfig = 0;
      this.game.scrambler.dificulty = 1;

      this.game.world.fov = 10;
      this.game.world.resize();

      this.game.themes.setTheme( 'vivid' );

      this.savePreferences();

      return false;

    }

  }

  savePreferences() {

    const preferences = {
      cubeSize: this.game.cube.size,
      flipConfig: this.game.controls.flipConfig,
      dificulty: this.game.scrambler.dificulty,
      fov: this.game.world.fov,
      theme: this.game.themes.theme,
      colors: this.game.themes.colors,
      colorVersion: 11, // Bump this to force color reset for all users
    };

    localStorage.setItem( 'theCube_preferences', JSON.stringify( preferences ) );

  }

  clearPreferences() {

    localStorage.removeItem( 'theCube_preferences' );

  }

}

class Themes {

  constructor( game ) {

    this.game = game;
    this.theme = null;

    // Five high-separation palettes tested under protanopia, deuteranopia,
    // and tritanopia simulation. Every sticker also clears 3:1 contrast
    // against its cubie body in source sRGB.
    this.defaults = {
      vivid: {
        // Vivid - high contrast with a brighter blue anchor
        U: 0xFFD800, // Yellow
        D: 0xFFFFFF, // White
        F: 0xFF0000, // Red
        R: 0x42D4F4, // Light Blue
        B: 0xFF2D95, // Pink
        L: 0x0066CC, // Strong Blue
        P: 0x111111, // Near-black piece body
        G: 0xf2f2f2, // Light gray bg
      },
      sunset: {
        // Sunset - warm base with cool anchors for reliable separation
        U: 0xFFC400, // Gold
        D: 0xFFFFFF, // White
        F: 0xFF3D00, // Bright Red-Orange
        R: 0x8C52FF, // Violet
        B: 0xC000A0, // Magenta
        L: 0x00D5FF, // Cyan
        P: 0x111111, // Near-black piece
        G: 0xfff8f0, // Warm white bg
      },
      ocean: {
        // Ocean - cool base with warm navigational anchors
        U: 0xFFD800, // Yellow
        D: 0xFFFFFF, // White
        F: 0xE6007A, // Deep Pink
        R: 0x2962FF, // Azure
        B: 0x00B8D4, // Teal
        L: 0xA15C00, // Burnt Amber
        P: 0x080F12, // Near-black blue piece
        G: 0xf0ffff, // Azure bg
      },
      neon: {
        // Neon - saturated accents with a neutral white-face substitute
        U: 0xFFFF00, // Electric Yellow
        D: 0xB0B0B0, // Silver
        F: 0xF50057, // Hot Pink
        R: 0x00B0FF, // Electric Blue
        B: 0xFF7A00, // Neon Orange
        L: 0x8C52FF, // Electric Violet
        P: 0x111111, // Near black piece
        G: 0xfafafa, // White bg
      },
      pastel: {
        // Pastel - hard pastels with stronger neutral and green anchors
        U: 0xFFEB3B, // Sunshine Yellow
        D: 0xB8B8B8, // Soft Gray
        F: 0xFF6E40, // Coral
        R: 0x40C4FF, // Sky Blue
        B: 0x7C4DFF, // Lavender
        L: 0x009E73, // Deep Emerald
        P: 0x222222, // Dark gray piece
        G: 0xfaf8f5, // Off-white bg
      },
    };
    
    this.themeList = [ 'vivid', 'sunset', 'ocean', 'neon', 'pastel' ];
    this.currentThemeIndex = 0;

    this.colors = JSON.parse( JSON.stringify( this.defaults ) );

  }

  getColors() {

    return this.colors[ this.theme ];

  }

  nextTheme() {
    
    this.currentThemeIndex = ( this.currentThemeIndex + 1 ) % this.themeList.length;
    this.setTheme( this.themeList[ this.currentThemeIndex ], true );
    this.game.announce( `Color theme ${ this.currentThemeIndex + 1 } of ${ this.themeList.length }` );
    notifyNativePositiveMoment( 'theme' );
    
  }

  setTheme( theme = false, force = false ) {

    if ( theme === this.theme && force === false ) return;
    if ( theme !== false ) {
      this.theme = theme;
      const themeIndex = this.themeList.indexOf( theme );
      if ( themeIndex >= 0 ) this.currentThemeIndex = themeIndex;
    }

    const colors = this.getColors();

    this.game.dom.prefs.querySelectorAll( '.range__handle div' ).forEach( range => {

      range.style.background = '#' + colors.R.toString(16).padStart(6, '0');

    } );

    this.game.cube.updateColors( colors );

    this.game.confetti.updateColors( colors );

    this.game.dom.back.style.background = '#' + colors.G.toString(16).padStart(6, '0');

  }

}

class ThemeEditor {

  constructor( game ) {

    this.game = game;

    this.editColor = 'R';

    this.getPieceColor = this.getPieceColor.bind( this );

  }

  colorFromHSL( h, s, l ) {

    h = Math.round( h );
    s = Math.round( s );
    l = Math.round( l );

    return new THREE.Color( `hsl(${h}, ${s}%, ${l}%)` );

  }

  setHSL( color = null, animate = false ) {

    this.editColor = ( color === null) ? 'R' : color;

    const hsl = new THREE.Color( this.game.themes.getColors()[ this.editColor ] );

    const { h, s, l } = hsl.getHSL( hsl );
    const { hue, saturation, lightness } = this.game.preferences.ranges;

    if ( animate ) {

      const ho = hue.value / 360;
      const so = saturation.value / 100;
      const lo = lightness.value / 100;

      const colorOld = this.colorFromHSL( hue.value, saturation.value, lightness.value );

      if ( this.tweenHSL ) this.tweenHSL.stop();

      this.tweenHSL = new Tween( {
        duration: 200,
        easing: Easing.Sine.Out(),
        onUpdate: tween => {

          hue.setValue( ( ho + ( h - ho ) * tween.value ) * 360 );
          saturation.setValue( ( so + ( s - so ) * tween.value ) * 100 );
          lightness.setValue( ( lo + ( l - lo ) * tween.value ) * 100 );

          const colorTween = colorOld.clone().lerp( hsl, tween.value );

          const colorTweenStyle = colorTween.getStyle();
          const colorTweenHex = colorTween.getHSL( colorTween );

          hue.handle.style.color = colorTweenStyle;
          saturation.handle.style.color = colorTweenStyle;
          lightness.handle.style.color = colorTweenStyle;

          saturation.track.style.color =
            this.colorFromHSL( colorTweenHex.h * 360, 100, 50 ).getStyle();
          lightness.track.style.color =
            this.colorFromHSL( colorTweenHex.h * 360, colorTweenHex.s * 100, 50 ).getStyle();

          this.game.dom.theme.style.display = 'none';
          this.game.dom.theme.offsetHeight;
          this.game.dom.theme.style.display = '';

        },
        onComplete: () => {

          this.updateHSL();
          this.game.storage.savePreferences();

        },
      } );

    } else {

      hue.setValue( h * 360 );
      saturation.setValue( s * 100 );
      lightness.setValue( l * 100 );

      this.updateHSL();
      this.game.storage.savePreferences();

    }

  }

  updateHSL() {

    const { hue, saturation, lightness } = this.game.preferences.ranges;

    const h = hue.value;
    const s = saturation.value;
    const l = lightness.value;

    const color = this.colorFromHSL( h, s, l ).getStyle();

    hue.handle.style.color = color;
    saturation.handle.style.color = color;
    lightness.handle.style.color = color;

    saturation.track.style.color = this.colorFromHSL( h, 100, 50 ).getStyle();
    lightness.track.style.color = this.colorFromHSL( h, s, 50 ).getStyle();

    this.game.dom.theme.style.display = 'none';
    this.game.dom.theme.offsetHeight;
    this.game.dom.theme.style.display = '';

    const theme = this.game.themes.theme;

    this.game.themes.colors[ theme ][ this.editColor ] = this.colorFromHSL( h, s, l ).getHex();
    this.game.themes.setTheme();

  }

  colorPicker( enable ) {

    if ( enable ) {

      this.game.dom.game.addEventListener( 'click', this.getPieceColor, false );

    } else {

      this.game.dom.game.removeEventListener( 'click', this.getPieceColor, false );

    }

  }

  getPieceColor( event ) {

    const clickEvent = event.touches
      ? ( event.touches[ 0 ] || event.changedTouches[ 0 ] )
      : event;

    const clickPosition = new THREE.Vector2( clickEvent.pageX, clickEvent.pageY );

    let edgeIntersect = this.game.controls.getIntersect( clickPosition, this.game.cube.edges, true );
    let pieceIntersect = this.game.controls.getIntersect( clickPosition, this.game.cube.cubes, true );

    if ( edgeIntersect !== false ) {

      const edge = edgeIntersect.object;

      const position = edge.parent
        .localToWorld( edge.position.clone() )
        .sub( this.game.cube.object.position )
        .sub( this.game.cube.animator.position );

      const mainAxis = this.game.controls.getMainAxis( position );
      if ( position.multiplyScalar( 2 ).round()[ mainAxis ] < 1 ) edgeIntersect = false;

    }

    const name = edgeIntersect ? edgeIntersect.object.name : pieceIntersect ? 'P' : 'G';

    this.setHSL( name, true );

  }

  resetTheme() {

    this.game.themes.colors[ this.game.themes.theme ] =
      JSON.parse( JSON.stringify( this.game.themes.defaults[ this.game.themes.theme ] ) );

    this.game.themes.setTheme();

    this.setHSL( this.editColor, true );

  }

}

const States = {
  3: {
    checkerboard: {
      names: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26 ],
      positions: [
        { "x": 1/3, "y": -1/3, "z": 1/3 },
        { "x": -1/3, "y": 1/3, "z": 0 },
        { "x": 1/3, "y": -1/3, "z": -1/3 },
        { "x": -1/3, "y": 0, "z": -1/3 },
        { "x": 1/3, "y": 0, "z": 0 },
        { "x": -1/3, "y": 0, "z": 1/3 },
        { "x": 1/3, "y": 1/3, "z": 1/3 },
        { "x": -1/3, "y": -1/3, "z": 0 },
        { "x": 1/3, "y": 1/3, "z": -1/3 },
        { "x": 0, "y": 1/3, "z": -1/3 },
        { "x": 0, "y": -1/3, "z": 0 },
        { "x": 0, "y": 1/3, "z": 1/3 },
        { "x": 0, "y": 0, "z": 1/3 },
        { "x": 0, "y": 0, "z": 0 },
        { "x": 0, "y": 0, "z": -1/3 },
        { "x": 0, "y": -1/3, "z": -1/3 },
        { "x": 0, "y": 1/3, "z": 0 },
        { "x": 0, "y": -1/3, "z": 1/3 },
        { "x": -1/3, "y": -1/3, "z": 1/3 },
        { "x": 1/3, "y": 1/3, "z": 0 },
        { "x": -1/3, "y": -1/3, "z": -1/3 },
        { "x": 1/3, "y": 0, "z": -1/3 },
        { "x": -1/3, "y": 0, "z": 0 },
        { "x": 1/3, "y": 0, "z": 1/3 },
        { "x": -1/3, "y": 1/3, "z": 1/3 },
        { "x": 1/3, "y": -1/3, "z": 0 },
        { "x": -1/3, "y": 1/3, "z": -1/3 }
      ],
      rotations: [
        { "x": -Math.PI, "y": 0, "z": Math.PI, },
        { "x": Math.PI, "y": 0, "z": 0 },
        { "x": -Math.PI, "y": 0, "z": Math.PI },
        { "x": 0, "y": 0, "z": 0 },
        { "x": 0, "y": 0, "z": Math.PI },
        { "x": 0, "y": 0, "z": 0 },
        { "x": -Math.PI, "y": 0, "z": Math.PI },
        { "x": Math.PI, "y": 0, "z": 0 },
        { "x": -Math.PI, "y": 0, "z": Math.PI },
        { "x": 0, "y": 0, "z": Math.PI },
        { "x": 0, "y": 0, "z": 0 },
        { "x": 0, "y": 0, "z": Math.PI },
        { "x": -Math.PI, "y": 0, "z": 0 },
        { "x": Math.PI, "y": 0, "z": Math.PI },
        { "x": Math.PI, "y": 0, "z": 0 },
        { "x": 0, "y": 0, "z": Math.PI },
        { "x": 0, "y": 0, "z": 0 },
        { "x": 0, "y": 0, "z": Math.PI },
        { "x": Math.PI, "y": 0, "z": Math.PI },
        { "x": -Math.PI, "y": 0, "z": 0 },
        { "x": Math.PI, "y": 0, "z": Math.PI },
        { "x": 0, "y": 0, "z": 0 },
        { "x": 0, "y": 0, "z": Math.PI },
        { "x": 0, "y": 0, "z": 0 },
        { "x": Math.PI, "y": 0, "z": Math.PI },
        { "x": -Math.PI, "y": 0, "z": 0 },
        { "x": Math.PI, "y": 0, "z": Math.PI }
      ],
      size: 3,
    },
  }
};


const STATE = {
  Menu: 0,
  Playing: 1,
  Complete: 2,
  Stats: 3,
  Prefs: 4,
  Theme: 5,
};

const BUTTONS = {
  Menu: [ 'stats' ],  // Removed 'prefs' - Swiss minimal design
  Playing: [ 'back' ],
  Complete: [],
  Stats: [],
  Prefs: [ 'back' ],  // Simplified
  Theme: [ 'back' ],  // Simplified
  None: [],
};

const SHOW = true;
const HIDE = false;

class Game {

  constructor() {

    this.dom = {
      ui: document.querySelector( '.ui' ),
      game: document.querySelector( '.ui__game' ),
      back: document.querySelector( '.ui__background' ),
      prefs: document.querySelector( '.ui__prefs' ),
      stats: document.querySelector( '.ui__stats' ),
      texts: {
        title: document.querySelector( '.text--title' ),
        note: document.querySelector( '.text--note' ),
        timer: document.querySelector( '.text--timer' ),
        complete: document.querySelector( '.text--complete' ),
        best: document.querySelector( '.text--best-time' ),
        theme: document.querySelector( '.text--theme' ),
        level: document.querySelector( '.level-indicator' ),
      },
      buttons: {
        back: document.querySelector( '.size-btn--restart' ),
        stats: document.querySelector( '.btn--stats' ),
      },
      scoreboardClose: document.querySelector( '.scoreboard-close' ),
      scoreboardBoards: document.querySelector( '.scoreboard-boards' ),
      scoreboardLicenses: document.querySelector( '.scoreboard-licenses' ),
      licenses: document.querySelector( '.ui__licenses' ),
      initials: document.querySelector( '.ui__initials' ),
      sizePicker: document.querySelectorAll( '.size-btn' ),
    };

    this.world = new World( this );
    this.cube = new Cube( this );
    this.controls = new Controls( this );
    this.scrambler = new Scrambler( this );
    this.transition = new Transition( this );
    this.timer = new Timer( this );
    this.preferences = new Preferences( this );
    this.scores = new Scores( this );
    this.storage = new Storage( this );
    this.confetti = new Confetti( this );
    this.themes = new Themes( this );
    this.themeEditor = new ThemeEditor( this );

    this.initActions();

    this.state = STATE.Menu;
    this.newGame = false;
    this.saved = false;

    this.storage.init();
    this.preferences.init();
    this.cube.init();
    this.transition.init();

    // Attention wiggle system - irregular wiggle to attract attention when idle
    this.lastInteractionTime = Date.now();
    this.wiggleScheduled = false;
    this.wiggleInProgress = false;
    this.scheduleNextWiggle();
    
    // Track user interactions to reset idle timer
    document.addEventListener( 'mousedown', () => this.resetIdleTimer(), false );
    document.addEventListener( 'touchstart', () => this.resetIdleTimer(), false );
    document.addEventListener( 'mousemove', () => this.resetIdleTimer(), false );

    // PROGRESSION MODE: Clear any saved game state and force menu state
    this.storage.clearGame();
    this.state = STATE.Menu;
    this.saved = false;
    this.scores.calcStats();
    this.loadLeaderboard();

    // Force hide all panels that might be visible from previous sessions
    this.dom.stats.style.opacity = '0';
    this.dom.stats.style.pointerEvents = 'none';
    this.dom.prefs.style.opacity = '0';
    this.dom.prefs.style.pointerEvents = 'none';
    
    // Update level indicator
    this.updateLevelIndicator();

    // Store timeout IDs so they can be cancelled if user clicks scramble during load
    this.autoStartTimeouts = [];

    this.autoStartTimeouts.push( setTimeout( () => {
      // Check if auto-start was cancelled before starting cube animation
      if ( this.autoStartCancelled ) return;

      this.transition.float();
      this.transition.cube( SHOW );

      // AUTO-START: Skip title, scramble immediately and start game
      this.autoStartTimeouts.push( setTimeout( () => {
        // Check if auto-start was cancelled
        if ( this.autoStartCancelled ) return;
        
        // Don't show title - go straight to game
        const duration = this.doScramble();
        this.newGame = true;
        this.saved = true;
        this.state = STATE.Playing;
        
        this.transition.zoom( STATE.Playing, duration );
        
        this.autoStartTimeouts.push( setTimeout( () => {
          if ( this.autoStartCancelled ) return;
          this.transition.timer( SHOW );
          this.transition.buttons( BUTTONS.Playing, BUTTONS.None );
        }, Math.max( 0, duration - 1000 ) ) );
        
        this.autoStartTimeouts.push( setTimeout( () => {
          if ( this.autoStartCancelled ) return;
          this.controls.enable();
        }, duration ) );
        
      }, 1000 ) );

    }, 500 ) );

  }

  initActions() {

    let tappedTwice = false;

    this.dom.game.addEventListener( 'click', event => {

      if ( this.transition.activeTransitions > 0 ) return;
      if ( this.state === STATE.Playing ) return;

      if ( this.state === STATE.Menu ) {

        if ( ! tappedTwice ) {

          tappedTwice = true;
          setTimeout( () => tappedTwice = false, 300 );
          return false;

        }

        this.game( SHOW );

      } else if ( this.state === STATE.Complete ) {

        this.complete( HIDE );

      } else if ( this.state === STATE.Stats ) {

        this.stats( HIDE );

      } 

    }, false );

    this.controls.onMove = () => {

      if ( this.newGame ) {

        this.timer.start( true );
        this.newGame = false;

      }
      
      // Visual effects on move
      this.triggerMoveEffects();
      
      // Check progress and maybe show fun comment
      this.timer.checkProgress();

    };

    this.dom.buttons.back.onclick = event => {

      if ( this.state === STATE.Playing ) {

        // Robust reset - kills all position tweens and resets cube (also resets activeTransitions)
        this.resetCubeForScramble();

        // INSTANT RESTART: Skip menu, scramble immediately
        this.controls.disable();
        this.timer.stop();
        this.timer.reset();
        this.timer.setText(); // Update timer display to 0:00
        this.cube.reset();
        
        this.newGame = true;
        this.saved = false;

        this.doScramble( () => {
          this.controls.enable();
          this.onScrambleComplete();
        } );

      }

    };

    this.dom.buttons.stats.onclick = event => this.stats( SHOW );

    if ( this.dom.scoreboardClose ) {
      this.dom.scoreboardClose.onclick = event => this.stats( HIDE );
    }

    // License notices: the bundled page is put in a frame only while it is
    // open, so opening and closing it never adds a history entry and the game
    // underneath keeps its state.
    if ( this.dom.scoreboardLicenses && this.dom.licenses ) {
      const overlay = this.dom.licenses;
      const host = overlay.querySelector( '.licenses-page' );
      const close = overlay.querySelector( '.licenses-close' );
      this.dom.scoreboardLicenses.onclick = event => {
        const frame = document.createElement( 'iframe' );
        frame.title = 'License notices';
        frame.src = './licenses/index.html';
        host.replaceChildren( frame );
        overlay.classList.add( 'is-open' );
        overlay.setAttribute( 'aria-hidden', 'false' );
        overlay.inert = false;
        this.dom.stats.inert = true;
        close.focus();
      };
      close.onclick = event => {
        overlay.classList.remove( 'is-open' );
        overlay.setAttribute( 'aria-hidden', 'true' );
        host.replaceChildren();
        overlay.inert = true;
        this.dom.stats.inert = false;
        this.dom.scoreboardLicenses.focus();
      };
    }

    // Size picker buttons - skip to any cube size
    this.dom.sizePicker.forEach( btn => {
      btn.onclick = event => {
        // Handle palette button separately
        if ( btn.classList.contains( 'size-btn--palette' ) ) {
          this.themes.nextTheme();
          this.storage.savePreferences();
          return;
        }
        
        // Handle restart button
        if ( btn.classList.contains( 'size-btn--restart' ) ) {
          // Robust reset - kills all position tweens and resets cube (also resets activeTransitions)
          this.resetCubeForScramble();
          
          // INSTANT SCRAMBLE: Just scramble the cube, no zoom or state changes
          this.controls.disable();
          this.timer.stop();
          this.timer.reset();
          this.timer.setText(); // Update timer display to 0:00
          this.cube.reset();
          
          this.newGame = true;
          this.saved = false;

          // Abort any ongoing scramble
          this.controls.abortScramble();

          notifyNativePositiveMoment( 'restart' );

          this.doScramble( () => {
            this.controls.enable();
            this.onScrambleComplete();
          } );
          return;
        }
        
        const size = parseInt( btn.dataset.size );
        if ( isNaN( size ) || size === this.cube.size ) return; // Already at this size or invalid
        
        const oldSize = this.cube.size;
        const goingUp = size > oldSize;
        
        // Show playful message based on direction
        const upMessages = [ 'wow, tough guy', 'feeling brave?', 'oh, ambitious!', 'big leagues now', 'challenge accepted?' ];
        const downMessages = [ 'you sure?', 'no shame in it', 'taking it easy?', 'smart move', 'back to basics' ];
        const messages = goingUp ? upMessages : downMessages;
        const message = messages[ Math.floor( Math.random() * messages.length ) ];
        this.timer.showMessage( message, 1200 );

        // Same hard reset as restart: kill tweens, abort mid-turn scramble
        // (returns pieces from the flip group), then rebuild at the new size.
        this.resetCubeForScramble();
        this.controls.abortScramble();
        this.controls.disable();
        this.timer.stop();
        this.timer.reset();
        this.timer.setText();

        this.cube.size = size;
        this.preferences.ranges.size.setValue( size );
        this.cube.resize( true );
        this.updateLevelIndicator();

        this.cube.reset();
        this.newGame = true;
        this.saved = false;

        notifyNativePositiveMoment( 'size' );

        this.doScramble( () => {
          this.controls.enable();
          this.onScrambleComplete();
        } );
      };
    });

    // Backup handler for hidden restart button (in case it becomes visible)
    const visibleRestartBtn = document.querySelector( '.btn--bl.btn--restart' );
    if ( visibleRestartBtn ) {
      visibleRestartBtn.onclick = () => {
        // Robust reset - kills all position tweens and resets cube (also resets activeTransitions)
        this.resetCubeForScramble();
        
        // Same simple scramble logic
        this.controls.disable();
        this.timer.stop();
        this.timer.reset();
        this.timer.setText();
        this.cube.reset();
        
        this.newGame = true;
        this.saved = false;

        this.doScramble( () => {
          this.controls.enable();
          this.onScrambleComplete();
        } );
      };
    }

    this.controls.onSolved = () => this.complete( SHOW );

  }

  game( show ) {

    if ( show ) {

      let duration = 0;

      if ( ! this.saved ) {

        duration = this.doScramble();
        this.newGame = true;

      }

      this.state = STATE.Playing;
      this.saved = true;

      this.transition.buttons( BUTTONS.None, BUTTONS.Menu );

      this.transition.zoom( STATE.Playing, duration );
      this.transition.title( HIDE );

      setTimeout( () => {

        this.transition.timer( SHOW );
        this.transition.buttons( BUTTONS.Playing, BUTTONS.None );

      }, this.transition.durations.zoom - 1000 );

      setTimeout( () => {

        this.controls.enable();
        if ( ! this.newGame ) this.timer.start( true );

      }, this.transition.durations.zoom );

    } else {

      this.state = STATE.Menu;

      this.transition.buttons( BUTTONS.Menu, BUTTONS.Playing );

      this.transition.zoom( STATE.Menu, 0 );

      this.controls.disable();
      if ( ! this.newGame ) this.timer.stop();
      this.transition.timer( HIDE );

      setTimeout( () => this.transition.title( SHOW ), this.transition.durations.zoom - 1000 );

      this.controls.disable();

    }

  }

  prefs( show ) {

    if ( show ) {

      if ( this.transition.activeTransitions > 0 ) return;

      this.state = STATE.Prefs;

      this.transition.buttons( BUTTONS.Prefs, BUTTONS.Menu );

      this.transition.title( HIDE );
      this.transition.cube( HIDE );

      setTimeout( () => this.transition.preferences( SHOW ), 1000 );

    } else {

      this.cube.resize();

      this.state = STATE.Menu;

      this.transition.buttons( BUTTONS.Menu, BUTTONS.Prefs );

      this.transition.preferences( HIDE );

      ( this.pendingRestoreTimeouts = this.pendingRestoreTimeouts || [] ).push(
        setTimeout( () => this.transition.cube( SHOW ), 500 ) );
      setTimeout( () => this.transition.title( SHOW ), 1200 );

    }

  }

  theme( show ) {

    this.themeEditor.colorPicker( show );
    
    if ( show ) {

      if ( this.transition.activeTransitions > 0 ) return;

      this.cube.loadFromData( States[ '3' ][ 'checkerboard' ] );

      this.themeEditor.setHSL( null, false );

      this.state = STATE.Theme;

      this.transition.buttons( BUTTONS.Theme, BUTTONS.Prefs );

      this.transition.preferences( HIDE );

      setTimeout( () => this.transition.cube( SHOW, true ), 500 );
      setTimeout( () => this.transition.theming( SHOW ), 1000 );

    } else {

      this.state = STATE.Prefs;

      this.transition.buttons( BUTTONS.Prefs, BUTTONS.Theme );

      this.transition.cube( HIDE, true );
      this.transition.theming( HIDE );

      setTimeout( () => this.transition.preferences( SHOW ), 1000 );
      setTimeout( () => {

        const gameCubeData = JSON.parse( localStorage.getItem( 'theCube_savedState' ) );

        if ( !gameCubeData ) {

          this.cube.resize( true );
          return;

        }

        this.cube.loadFromData( gameCubeData );

      }, 1500 );

    }

  }

  stats( show ) {

    if ( show ) {

      // Just reveal the board over the current game — viewing must not disturb
      // a game in progress (no state change, no cube fly-off, no reset). The
      // frosted backdrop covers the scene while it's open.
      this.scoreboardViewOnly = true;
      this.transition.stats( SHOW );

    } else {

      // Already closing (a second tap on Close, or Back during the fade).
      if ( ! this.boardOpen ) return;

      this.transition.stats( HIDE );

      // A plain view just closes; the game underneath is untouched.
      if ( this.scoreboardViewOnly ) { this.scoreboardViewOnly = false; return; }

      // Opened by a completion ("adding"): return to a fresh, playable state.
      this.state = STATE.Menu;
      this.transition.buttons( BUTTONS.Menu, BUTTONS.None );

      ( this.pendingRestoreTimeouts = this.pendingRestoreTimeouts || [] ).push(
        setTimeout( () => this.transition.cube( SHOW ), 500 ) );
      setTimeout( () => this.transition.title( SHOW ), 1200 );

    }

  }

  complete( show ) {

    if ( show ) {

      // PROGRESSION SYSTEM: Check if we should advance to next cube size
      const currentSize = this.cube.size;
      const maxSize = 5;

      if ( currentSize < maxSize ) {
        // Progress to next size!
        this.controls.disable();
        this.timer.stop();

        // Record this level's solve time for the run (the scoreboard reads it).
        this.runTimes = this.runTimes || {};
        this.runTimes[ currentSize ] = this.timer.deltaTime;
        this.announce( `${ currentSize } by ${ currentSize } solved in ${ this.timer.converted }. Next, ${ currentSize + 1 } by ${ currentSize + 1 }.` );

        // Brief celebration
        this.confetti.start();

        // Clue for native review gating: a real solve, after the win lands.
        setTimeout( () => notifyNativePositiveMoment( 'solved' ), 800 );
        
        setTimeout( () => {
          this.confetti.stop();
          
          // Increment cube size
          this.cube.size = currentSize + 1;
          this.preferences.ranges.size.setValue( currentSize + 1 );
          this.cube.resize();
          this.updateLevelIndicator();
          
          // Reset and scramble for next level
          this.cube.reset();
          this.timer.reset();
          this.saved = false;
          this.newGame = true;
          
          // Auto-scramble and start
          setTimeout( () => {
            const duration = this.doScramble();
            setTimeout( () => this.controls.enable(), duration + 500 );
          }, 500 );
          
        }, 1500 );
        
        return;
      }

      // MAX SIZE REACHED - Full completion celebration!
      this.transition.buttons( BUTTONS.Complete, BUTTONS.Playing );

      this.state = STATE.Complete;
      this.saved = false;

      this.controls.disable();
      this.timer.stop();
      this.storage.clearGame();

      this.bestTime = this.scores.addScore( this.timer.deltaTime );

      // Record the final level, then decide which of this run's times made a
      // per-size top-10. We hold the result and prompt once after the celebration.
      this.runTimes = this.runTimes || {};
      this.runTimes[ 5 ] = this.timer.deltaTime;
      this.pendingQualifiers = this.evaluateRunQualifiers();
      this.announce( `5 by 5 solved in ${ this.timer.converted }. Run complete${ this.bestTime ? ', with a new best time' : '' }. Tap to continue.` );

      this.transition.zoom( STATE.Menu, 0 );
      this.transition.elevate( SHOW );

      setTimeout( () => {

        this.transition.complete( SHOW, this.bestTime );
        this.confetti.start();
        
        // Effect B: Large particle burst on puzzle solve
        if ( this.world.spawnSolveBurst ) {
          this.world.spawnSolveBurst();
        }

        // Strongest engagement clue: finished the full 2→5 run.
        notifyNativePositiveMoment( this.bestTime ? 'best' : 'runComplete' );

      }, 1000 );

    } else {

      this.state = STATE.Stats;
      this.saved = false;

      this.transition.timer( HIDE );
      this.transition.complete( HIDE, this.bestTime );
      this.transition.cube( HIDE );
      this.timer.reset();

      setTimeout( () => {

        this.cube.reset();
        this.confetti.stop();
        
        // Reset to 2x2 for new progression run
        this.cube.size = 2;
        this.preferences.ranges.size.setValue( 2 );
        this.cube.resize();
        this.updateLevelIndicator();

        this.showScoreboardFlow();
        this.transition.elevate( 0 );

      }, 1000 );

      return false;

    }

  }

}

// Add updateLevelIndicator method to Game prototype
Game.prototype.updateLevelIndicator = function() {
  if ( this.dom.texts.level ) {
    const size = this.cube.size;
    this.dom.texts.level.textContent = `${size}×${size}`;
  }
  this.updateSizePickerActive();
};

// Say something to a screen reader without showing it.
Game.prototype.announce = function( text ) {
  const status = document.querySelector( '.sr-status' );
  if ( ! status ) return;
  status.textContent = '';
  setTimeout( () => { status.textContent = text; }, 50 );
};

// While the Best Times board is open, nothing behind it can be reached.
Game.prototype.setBehindBoard = function( behind ) {
  [ this.dom.game, this.dom.texts.title.parentNode, this.dom.buttons.stats.parentNode ].forEach( layer => {
    if ( layer ) layer.inert = behind;
  } );
};

// The Android Back button asks this first. It closes the page on top and
// answers true; when nothing is open it answers false and the app leaves.
Game.prototype.handleBack = function() {
  const licenses = this.dom.licenses;
  if ( licenses && licenses.classList.contains( 'is-open' ) ) {
    licenses.querySelector( '.licenses-close' ).click();
    return true;
  }
  // A new best time is waiting for a name: keep the time, under the name as typed.
  if ( this.dom.initials && this.dom.initials.classList.contains( 'is-open' ) ) {
    this.dom.initials.querySelector( '.initials-form' ).requestSubmit();
    return true;
  }
  if ( this.boardOpen ) {
    this.stats( HIDE );
    return true;
  }
  return false;
};

// Add updateSizePickerActive method to Game prototype
Game.prototype.updateSizePickerActive = function() {
  if ( this.dom.sizePicker ) {
    this.dom.sizePicker.forEach( btn => {
      const size = parseInt( btn.dataset.size );
      if ( size === this.cube.size ) {
        btn.classList.add( 'active' );
      } else {
        btn.classList.remove( 'active' );
      }
      if ( ! isNaN( size ) ) btn.setAttribute( 'aria-pressed', size === this.cube.size ? 'true' : 'false' );
    });
  }
};

// Visual effects - Background color response and progress glow

// Effect D: Background color response - background subtly shifts based on visible face colors
// Effect C: Progress glow - screen edges glow as you near solving
Game.prototype.updateProgressGlow = function() {
  if ( !this.cube ) return;
  
  const solvedFaces = this.cube.getSolvedFacesCount ? this.cube.getSolvedFacesCount() : 0;
  const progress = solvedFaces / 6; // 0 to 1
  
  document.documentElement.style.setProperty( '--progress-glow', progress.toString() );
};

// Trigger both effects on cube moves
Game.prototype.triggerMoveEffects = function() {
  this.updateProgressGlow();
  this.trackMoveProgress();
  
  // Update tile glow based on face completion
  if ( this.cube && this.cube.updateTileGlow ) {
    this.cube.updateTileGlow();
  }
};

// Robustly reset cube position for scramble - stops all tweens that could affect position
Game.prototype.resetCubeForScramble = function() {
  // Cancel any pending auto-start timeouts from initial page load
  this.autoStartCancelled = true;
  if ( this.autoStartTimeouts ) {
    this.autoStartTimeouts.forEach( id => clearTimeout( id ) );
    this.autoStartTimeouts = [];
  }

  // Cancel any pending menu/stats "bring the cube back" timeouts. A late one
  // firing after this reset would yank the centered cube up and re-fly it.
  if ( this.pendingRestoreTimeouts ) {
    this.pendingRestoreTimeouts.forEach( id => clearTimeout( id ) );
    this.pendingRestoreTimeouts = [];
  }

  // Set scramble-in-progress flag to block any new cube() transitions
  this.transition.scrambleInProgress = true;
  
  // Lock cube position to prevent any tween callbacks from modifying it
  this.transition.cubePositionLocked = true;
  
  // Stop ALL cube-related tweens INCLUDING float, and nullify their callbacks
  const tweensToKill = [ 'cube', 'zoom', 'rotate', 'elevate', 'float' ];
  
  tweensToKill.forEach( name => {
    try {
      if ( this.transition.tweens[ name ] ) {
        this.transition.tweens[ name ].stop();
        this.transition.tweens[ name ].onUpdate = () => {}; // Nullify callback
        this.transition.tweens[ name ].onComplete = () => {}; // Nullify callback
      }
    } catch(e) {}
  } );
  
  // Force reset all cube positions to default playing state
  this.cube.animator.position.set( 0, 0, 0 );
  this.cube.animator.rotation.set( 0, 0, 0 );
  this.cube.holder.position.set( 0, 0, 0 );
  this.cube.holder.rotation.set( 0, 0, 0 );
  this.cube.object.position.y = this.transition.data.cubeY;
  this.controls.edges.position.y = this.transition.data.cubeY;
  
  // Reset camera zoom to playing state
  this.world.camera.zoom = 1;
  this.world.camera.updateProjectionMatrix();
  
  // Ensure title is hidden (should not be visible during gameplay)
  if ( this.dom.texts.title ) {
    this.dom.texts.title.style.opacity = '0';
  }
  
  // Reset active transitions counter to prevent blocking
  this.transition.activeTransitions = 0;
  
  // Unlock position after a tick
  setTimeout( () => {
    this.transition.cubePositionLocked = false;
  }, 50 );
};

// Call this when scramble animation completes to allow new transitions
Game.prototype.onScrambleComplete = function() {
  this.transition.scrambleInProgress = false;
};

Game.prototype.doScramble = function( onComplete ) {
  this.controls.abortScramble();
  this.scrambler.scramble();
  notifyNativePlay( 'scramble' );
  this.controls.scrambleCube();
  this.announce( `${ this.cube.size } by ${ this.cube.size } cube, scrambled. The timer starts on your first turn.` );
  const duration = this.scrambler.converted.length * ( this.controls.flipSpeeds[0] + 10 );
  if ( onComplete ) setTimeout( onComplete, duration );
  return duration;
};

// Track move progress and trigger fun reactions
Game.prototype.trackMoveProgress = function() {
  if ( !this.moveTracking ) {
    this.moveTracking = {
      lastSolvedFaces: 0,
      uselessMoveStreak: 0,
      totalMoves: 0,
      lastMoveWasGood: false
    };
  }
  
  const currentSolved = this.cube.getSolvedFacesCount ? this.cube.getSolvedFacesCount() : 0;
  const previousSolved = this.moveTracking.lastSolvedFaces;
  
  this.moveTracking.totalMoves++;
  
  // Determine if move was helpful, neutral, or bad
  if ( currentSolved > previousSolved ) {
    // Good move - progress!
    this.moveTracking.uselessMoveStreak = 0;
    this.moveTracking.lastMoveWasGood = true;
    this.triggerHappyBounce();
  } else if ( currentSolved < previousSolved ) {
    // Bad move - lost progress
    this.moveTracking.uselessMoveStreak++;
    this.moveTracking.lastMoveWasGood = false;
    if ( this.moveTracking.uselessMoveStreak >= 5 ) {
      this.triggerFrustrationShake();
    }
  } else {
    // Neutral move - no change
    this.moveTracking.uselessMoveStreak++;
    this.moveTracking.lastMoveWasGood = false;
    if ( this.moveTracking.uselessMoveStreak >= 8 ) {
      this.triggerFrustrationShake();
      this.moveTracking.uselessMoveStreak = 0; // Reset after shake
    }
  }
  
  this.moveTracking.lastSolvedFaces = currentSolved;
};

// Frustration shake - cube shakes when user makes too many useless moves
Game.prototype.triggerFrustrationShake = function() {
  if ( !this.cube || !this.cube.holder || this.frustrationShaking ) return;
  
  this.frustrationShaking = true;
  const holder = this.cube.holder;
  const originalRotation = { x: holder.rotation.x, y: holder.rotation.y, z: holder.rotation.z };
  const intensity = 0.05;
  const duration = 400;
  const shakes = 6;
  let shakeCount = 0;
  
  const shake = () => {
    if ( shakeCount >= shakes * 2 ) {
      // Reset to original
      holder.rotation.x = originalRotation.x;
      holder.rotation.y = originalRotation.y;
      holder.rotation.z = originalRotation.z;
      this.frustrationShaking = false;
      return;
    }
    
    const direction = shakeCount % 2 === 0 ? 1 : -1;
    const decay = 1 - ( shakeCount / ( shakes * 2 ) );
    
    holder.rotation.z = originalRotation.z + ( intensity * direction * decay );
    holder.rotation.x = originalRotation.x + ( intensity * 0.3 * direction * decay );
    
    shakeCount++;
    setTimeout( shake, duration / ( shakes * 2 ) );
  };
  
  shake();
};

// Happy bounce - subtle bounce when making progress
Game.prototype.triggerHappyBounce = function() {
  if ( !this.cube || !this.cube.holder || this.happyBouncing ) return;
  
  this.happyBouncing = true;
  const holder = this.cube.holder;
  const originalY = holder.position.y;
  const bounceHeight = 0.03;
  const duration = 300;
  
  // Quick up
  let startTime = Date.now();
  const animate = () => {
    const elapsed = Date.now() - startTime;
    const progress = elapsed / duration;
    
    if ( progress >= 1 ) {
      holder.position.y = originalY;
      this.happyBouncing = false;
      return;
    }
    
    // Sine wave bounce
    const bounce = Math.sin( progress * Math.PI ) * bounceHeight;
    holder.position.y = originalY + bounce;
    
    requestAnimationFrame( animate );
  };
  
  animate();
};

// Dizzy spin - when cube is really confused (optional, triggered rarely)
Game.prototype.triggerDizzySpin = function() {
  if ( !this.cube || !this.cube.animator || this.dizzySpinning ) return;
  
  this.dizzySpinning = true;
  const animator = this.cube.animator;
  const startRotation = animator.rotation.y;
  const spinAmount = Math.PI * 0.5; // Quarter turn
  const duration = 500;
  const startTime = Date.now();
  
  const spin = () => {
    const elapsed = Date.now() - startTime;
    const progress = elapsed / duration;
    
    if ( progress >= 1 ) {
      animator.rotation.y = startRotation;
      this.dizzySpinning = false;
      return;
    }
    
    // Elastic ease out
    const elastic = 1 - Math.pow( 2, -10 * progress ) * Math.cos( progress * Math.PI * 2 );
    animator.rotation.y = startRotation + ( spinAmount * elastic * ( 1 - progress ) );
    
    requestAnimationFrame( spin );
  };
  
  spin();
};

// Attention wiggle system - irregular wiggle to attract attention
Game.prototype.resetIdleTimer = function() {
  this.lastInteractionTime = Date.now();
  
  // Cancel any in-progress wiggle on interaction
  if ( this.wiggleInProgress ) {
    this.wiggleInProgress = false;
  }
};

Game.prototype.scheduleNextWiggle = function() {
  if ( this.wiggleScheduled ) return;
  
  // Random delay between 8-15 seconds
  const delay = ( 8 + Math.random() * 7 ) * 1000;
  this.wiggleScheduled = true;
  
  setTimeout( () => {
    this.wiggleScheduled = false;
    this.checkAndWiggle();
  }, delay );
};

Game.prototype.checkAndWiggle = function() {
  const idleTime = Date.now() - this.lastInteractionTime;
  
  // Only wiggle if idle for at least 5 seconds
  if ( idleTime > 5000 && !this.wiggleInProgress && this.cube && this.cube.object ) {
    this.triggerAttentionWiggle();
  }
  
  // Schedule next wiggle check
  this.scheduleNextWiggle();
};

Game.prototype.triggerAttentionWiggle = function() {
  if ( this.wiggleInProgress || !this.cube || !this.cube.object ) return;
  
  this.wiggleInProgress = true;
  
  const cube = this.cube.object;
  const startRotation = {
    x: cube.rotation.x,
    y: cube.rotation.y,
    z: cube.rotation.z
  };
  
  // Random small wiggle angles
  const wiggleX = ( Math.random() - 0.5 ) * 0.15;
  const wiggleY = ( Math.random() - 0.5 ) * 0.15;
  
  // Irregular wiggle animation: quick back and forth
  const duration = 500;
  const startTime = Date.now();
  
  const animate = () => {
    if ( !this.wiggleInProgress ) {
      // Interaction interrupted - snap back
      cube.rotation.x = startRotation.x;
      cube.rotation.y = startRotation.y;
      cube.rotation.z = startRotation.z;
      return;
    }
    
    const elapsed = Date.now() - startTime;
    const progress = Math.min( elapsed / duration, 1 );
    
    // Easing: sharp start, smooth return (wiggle pattern)
    // Goes: 0 -> peak -> overshoot -> back to 0
    let wiggleFactor;
    if ( progress < 0.25 ) {
      // Quick move to peak
      wiggleFactor = Math.sin( progress * Math.PI * 2 ) * 1.2;
    } else if ( progress < 0.5 ) {
      // Slight overshoot
      wiggleFactor = Math.sin( progress * Math.PI * 2 ) * 0.6;
    } else {
      // Settle back with damping
      wiggleFactor = Math.sin( progress * Math.PI * 2 ) * ( 1 - progress ) * 0.5;
    }
    
    cube.rotation.x = startRotation.x + wiggleX * wiggleFactor;
    cube.rotation.y = startRotation.y + wiggleY * wiggleFactor;
    
    if ( progress < 1 ) {
      requestAnimationFrame( animate );
    } else {
      // Ensure we end exactly at start rotation
      cube.rotation.x = startRotation.x;
      cube.rotation.y = startRotation.y;
      cube.rotation.z = startRotation.z;
      this.wiggleInProgress = false;
    }
  };
  
  requestAnimationFrame( animate );
};

// ----- Scoreboard: per-size top-10 best times, persisted to localStorage -----

const LEADERBOARD_KEY = 'theCube_leaderboard';
const LEADERBOARD_NAME_KEY = 'theCube_lastName';
const LEADERBOARD_MAX = 10;
const LEADERBOARD_SIZES = [ 2, 3, 4, 5 ];

Game.prototype.loadLeaderboard = function() {
  try {
    const parsed = JSON.parse( localStorage.getItem( LEADERBOARD_KEY ) );
    this.leaderboard = ( parsed && typeof parsed === 'object' ) ? parsed : {};
  } catch ( e ) {
    this.leaderboard = {};
  }
  LEADERBOARD_SIZES.forEach( s => {
    if ( ! Array.isArray( this.leaderboard[ s ] ) ) this.leaderboard[ s ] = [];
  } );
  this.lbLastName = localStorage.getItem( LEADERBOARD_NAME_KEY ) || '';
  this.runTimes = this.runTimes || {};
};

Game.prototype.saveLeaderboard = function() {
  try { localStorage.setItem( LEADERBOARD_KEY, JSON.stringify( this.leaderboard ) ); } catch ( e ) {}
};

// A time qualifies if the board isn't full or it beats the slowest entry.
Game.prototype.lbQualifies = function( size, time ) {
  if ( ! ( time > 0 ) ) return false;
  const board = this.leaderboard[ size ] || [];
  return board.length < LEADERBOARD_MAX || time < board[ board.length - 1 ].t;
};

Game.prototype.lbInsert = function( size, time, name ) {
  const board = this.leaderboard[ size ] || ( this.leaderboard[ size ] = [] );
  board.push( { n: name, t: time } );
  board.sort( ( a, b ) => a.t - b.t );
  if ( board.length > LEADERBOARD_MAX ) board.length = LEADERBOARD_MAX;
};

// Which of this run's per-size times made their board? (Checked before insert.)
Game.prototype.evaluateRunQualifiers = function() {
  const times = this.runTimes || {};
  return LEADERBOARD_SIZES
    .filter( s => this.lbQualifies( s, times[ s ] ) )
    .map( s => ( { size: s, time: times[ s ] } ) );
};

// After the win celebration: prompt for initials if anything qualified, then
// reveal the board. Either way the board ends up on screen.
Game.prototype.showScoreboardFlow = function() {
  const qualifiers = this.pendingQualifiers || [];
  this.pendingQualifiers = null;
  this.runTimes = {};

  // This board was opened by a completion, so its Close should restore play.
  this.scoreboardViewOnly = false;

  if ( ! qualifiers.length ) { this.transition.stats( SHOW ); return; }

  this.promptInitials( qualifiers, () => {
    qualifiers.forEach( q => this.lbInsert( q.size, q.time, this.lbLastName ) );
    this.saveLeaderboard();
    this.lastNewEntries = qualifiers.map( q => ( { size: q.size, time: q.time, name: this.lbLastName } ) );
    this.transition.stats( SHOW );
  } );
};

Game.prototype.promptInitials = function( qualifiers, onSaved ) {
  const overlay = this.dom.initials;
  if ( ! overlay ) { onSaved(); return; }

  const input = overlay.querySelector( '.initials-input' );
  const sub = overlay.querySelector( '.initials-sub' );
  const form = overlay.querySelector( '.initials-form' );

  const sizes = qualifiers.map( q => `${q.size}×${q.size}` ).join( ', ' );
  sub.textContent = `Top ${LEADERBOARD_MAX} on ${sizes}. Add your initials to the board.`;
  input.value = this.lbLastName || '';

  overlay.classList.add( 'is-open' );
  overlay.setAttribute( 'aria-hidden', 'false' );
  overlay.inert = false;
  setTimeout( () => { try { input.focus(); input.select(); } catch ( e ) {} }, 60 );

  const submit = event => {
    if ( event ) event.preventDefault();
    let name = ( input.value || '' ).trim().replace( /\s+/g, ' ' ).slice( 0, 12 );
    if ( ! name ) name = '???';
    this.lbLastName = name;
    try { localStorage.setItem( LEADERBOARD_NAME_KEY, name ); } catch ( e ) {}
    form.onsubmit = null;
    overlay.classList.remove( 'is-open' );
    overlay.setAttribute( 'aria-hidden', 'true' );
    overlay.inert = true;
    onSaved();
  };

  form.onsubmit = submit;
};

Game.prototype.renderScoreboard = function() {
  const host = this.dom.scoreboardBoards;
  if ( ! host ) return;

  const isNew = ( size, entry ) => ( this.lastNewEntries || [] ).some(
    e => e.size === size && e.name === entry.n && e.time === entry.t
  );

  host.innerHTML = LEADERBOARD_SIZES.map( size => {
    const board = this.leaderboard[ size ] || [];
    const rows = board.length
      ? board.map( ( e, i ) => {
          const cls = 'sb-row' + ( isNew( size, e ) ? ' is-new' : '' );
          const name = String( e.n || '???' ).replace( /[<>&]/g, '' );
          return `<div class="${cls}"><span class="sb-rank">${i + 1}</span>`
            + `<span class="sb-name">${name}</span>`
            + `<span class="sb-time">${this.scores.convertTime( e.t )}</span></div>`;
        } ).join( '' )
      : '<div class="sb-empty">No times yet</div>';
    return `<div class="sb-board"><div class="sb-board-title">${size}×${size}</div>${rows}</div>`;
  } ).join( '' );
};

window.gameVersion = '0.99.8';
window.game = new Game();
