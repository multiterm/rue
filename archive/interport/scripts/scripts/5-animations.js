// Background Animation

Events.on('anime', () => {
        let c = document.createElement('canvas');
        document.body.appendChild(c);
        let style = c.style;
        style.width = '100%';
        style.position = 'absolute';
        style.zIndex = -1;
        style.top = 0;
        style.left = 0;
        let ctx = c.getContext('2d');
        let x0, y0, w, h, dw;

        function init() {
            w = window.innerWidth;
            h = window.innerHeight;
            c.width = w;
            c.height = h;
            let offset = h > 380 ? 100 : 65;
            offset = h > 800 ? 116 : offset;
            x0 = w / 2;
            y0 = h - offset;
            dw = Math.max(w, h, 1000) / 13;
            drawCircles();
        }
        window.onresize = init;

        function drawCircle(radius) {
            ctx.beginPath();
            let colorArray = ['#fc7e63ff', '#55c3c2ff',  '#f9bc89ff', '#968ba5ff',  '#fa9397ff', '#c7ceeaff']
            let i = Math.floor(colorArray.length*Math.random())
            let randomColor = colorArray[i];
            let color = hex2rgba(randomColor);
            ctx.strokeStyle = color;
            ctx.arc(x0, y0, radius, 0, 2 * Math.PI);
            ctx.setLineDash([60]);
            ctx.stroke();
            ctx.lineWidth = 2;
        }

        let step = 0;


        function hex2rgba(hexa){
            var r = parseInt(hexa.slice(1,3), 16);
                g = parseInt(hexa.slice(3,5), 16);
                b = parseInt(hexa.slice(5,7), 16);
                a = 0.3
            return 'rgba('+r+', '+g+', '+b+', '+a+')';
          }
          
        function drawCircles() {
            ctx.clearRect(0, 0, w, h);
            for (let i = 0; i < 8; i++) {
                drawCircle(dw * i + step % dw);
            }
            step += 1;
        }

        let loading = true;

        function animate() {
            if (loading || step % dw < dw - 5) {
                requestAnimationFrame(function() {
                    drawCircles();
                    animate();
                });
            }
        }
        window.animateBackground = function(l) {
            loading = l;
            animate();
        };
        init();
        animate();
});


// Information window animation

Events.on('info-anime', () => {

        // properties and initial velocity
        const defaultProps = {
            bounce: 0.75,
            radius: 30,
            color: 'red'
        }
        
        class Ball {
            constructor (x = 0, y = 0, sceneProps, props) {
            this.props = {
                ...defaultProps,
                startVelX: (Math.random() * 5 + 5) * (Math.floor(Math.random() * 2) || -1),
                startVelY: (Math.random() * 5 + 5) * (Math.floor(Math.random() * 2) || -1),
                ...props
            }
            this.sceneProps = sceneProps
        
            this.x = x
            this.y = y
            this.velX = this.props.startVelX
            this.velY = this.props.startVelY
            }
        
            draw (ctx) {
            const { x, y, props } = this
        
            ctx.save()
            ctx.beginPath()
            ctx.fillStyle = props.color
            ctx.arc(
                x, y,
                props.radius,
                0, Math.PI * 2
            )
            ctx.fill()
            ctx.restore()
            }
        
            update () {
            const { props, sceneProps } = this
        
            // bottom bound / floor
            if (this.y + props.radius >= sceneProps.height) {
                this.velY *= -props.bounce
                this.y = sceneProps.height - props.radius
                this.velX *= sceneProps.friction
            }
            // top bound / ceiling
            if (this.y - props.radius <= 0) {
                this.velY *= -props.bounce
                this.y = props.radius
                this.velX *= sceneProps.friction
            }
        
            // left bound
            if (this.x - props.radius <= 0) {
                this.velX *= -props.bounce
                this.x = props.radius
            }
            // right bound
            if (this.x + props.radius >= sceneProps.width) {
                this.velX *= -props.bounce
                this.x = sceneProps.width - props.radius
            }
        
            // reset insignificant amounts to 0
            if (this.velX < 0.01 && this.velX > -0.01) {
                this.velX = 0
            }
            if (this.velY < 0.01 && this.velY > -0.01) {
                this.velY = 0
            }
        
            // update position
            this.velY += sceneProps.gravity
            this.x += this.velX
            this.y += this.velY
            }
        }

        // some default values
        const defaultConfig = {
        width: window.innerWidth,
        height: window.innerHeight,
        gravity: 0,
        friction: 0.98
        }

        // classes are functions that create objects
        // and we're exporting it to use in another file

        class Scene {
        // constructor function is the equivalent of
        // the init function
        constructor (config) {
            // get the canvas and context

            this.canvas = document.createElement('canvas');
            $("info-animation").appendChild(this.canvas);
            this.ctx = this.canvas.getContext('2d')

            // world/physics settings
            // merge default config & any passed in config
            this.config = {
            ...defaultConfig,
            ...config
            }

            // set the canvas id
            this.canvas.id = "info-canvas"

            // set the canvas style
            this.style = this.canvas.style
            this.style.width = '100%';
            this.style.position = 'absolute';
            this.style.zIndex = 3;
            this.style.top = 0;
            this.style.left = 0;
            this.style.animation = 'fade-in 300ms';
            this.style.animationDelay = '250ms';
            this.style.animationFillMode = 'backwards';
            this.style.overflow = 'hidden';


            // set the canvas size
            this.canvas.width = this.config.width
            this.canvas.height = this.config.height

            this.createBalls()

            // begin update loop
            // use an arrow function so that we can use `this` properly


            Events.on('loop', () => this.update())
        }

        createBalls () {
            const { config } = this
            const colors = ['#fc7e63', '#55c3c2',  '#f9bc89', '#968ba5',  '#fa9397']
            // build an array of ball objects
            const balls = []

            for (let i = 0; i < 20; i++) {
            balls.push(
                new Ball(
                // random X Y position
                Math.random() * config.width, Math.random() * config.height,
                // scene config
                {
                    // default width, height, friction
                    ...config,
                    // random positive or negative gravity
                    gravity: config.gravity * (Math.floor(Math.random() * 2) || -1)
                },
                // ball properties
                {
                    // extra bouncey
                    bounce: 0.90,
                    // size 10-30
                    radius: Math.random() * 20 + 10,
                    // random color
                    color: colors[Math.floor(Math.random() * colors.length)]
                }
                )
            )
            }

            this.balls = balls

            Events.on('info-anime-stop', () => {
                this.balls='';
            });
        }

        update () {
            // destructure the scene's variables
            const { ctx, config, balls } = this


            if( looping == true) {
            // queue the next update
            window.requestAnimationFrame(() => this.update())

            // clear the canvas
            ctx.clearRect(0, 0, config.width, config.height)

            // update objects
            balls.forEach(ball => ball.update())

            // draw objects
            balls.forEach(ball => ball.draw(ctx))

            } else {
                return;
            }
        }
        }

    new Scene();

    let looping = true;

    Events.on('info-anime-stop', () => {
        return looping = false;
    });

    if(looping == true ){
        Events.fire('loop');

    }
});