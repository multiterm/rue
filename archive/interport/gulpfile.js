const gulp  = require("gulp");
const minify = require("gulp-minify");
var concat = require('gulp-concat');
var rename = require('gulp-rename');
var uglify = require('gulp-uglify');

//script paths
var jsFiles = 'scripts/scripts/*.js',
    jsDest = 'client/public/dist/scripts'
    jscatDest = 'scripts/concat';

    gulp.task('scripts', function() {
        return gulp.src(jsFiles)
            .pipe(concat('scripts.js'))
            .pipe(gulp.dest(jscatDest))
            .pipe(rename('scripts.min.js'))
            .pipe(uglify())
            .pipe(gulp.dest(jsDest));
    });
    

    var depFiles = 'scripts/dependents/*.js',
    depDest = 'client/public/dist/dependents';

    gulp.task('dependents', function() {
        return gulp.src(depFiles)
            .pipe(concat('dependents.js'))
            .pipe(gulp.dest(jscatDest))
            .pipe(rename('dependents.min.js'))
            .pipe(uglify())
            .pipe(gulp.dest(depDest));
    });


    var pluFiles = 'scripts/plugins/*.js',
    pluDest = 'client/public/dist/plugins';

    gulp.task('plugins', function() {
        return gulp.src(pluFiles)
            .pipe(concat('plugins.js'))
            .pipe(gulp.dest(jscatDest))
            .pipe(rename('plugins.min.js'))
            .pipe(uglify())
            .pipe(gulp.dest(pluDest));
    });
    