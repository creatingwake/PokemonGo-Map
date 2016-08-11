/*eslint no-unused-vars: ["error", { "varsIgnorePattern": "initMap" }]*/
/*global google */
/*global centerLat */
/*global centerLng */
/*global $ */

var map
var polygons = {}
var gPolygonId = 0

function refreshOutput () {
  var polystrings = []
  var coords = []
  $.each(polygons, function (index, poly) {
    // polypaths!
    var arr = []
    poly.getPath().forEach(function (latLng) {
      arr.push([latLng.lat(), latLng.lng()])
    })
    polystrings.push(arr)
    // coords!
    $.each(poly.circles, function (index, circle) {
      coords.push([circle.center.lat(), circle.center.lng()])
    })
  })
  $('#polylist').text(JSON.stringify(polystrings))
  $('#coordlist').text(JSON.stringify(coords))
}

function initMap () {
  google.maps.LatLng.prototype.destinationPoint = function (brng, dist) {
    dist = dist / 6371
    brng = brng.toRad()

    var lat1 = this.lat().toRad()
    var lon1 = this.lng().toRad()

    var lat2 = Math.asin(Math.sin(lat1) * Math.cos(dist) +
                         Math.cos(lat1) * Math.sin(dist) * Math.cos(brng))

    var lon2 = lon1 + Math.atan2(Math.sin(brng) * Math.sin(dist) *
                                 Math.cos(lat1),
                                 Math.cos(dist) - Math.sin(lat1) *
                                 Math.sin(lat2))

    if (isNaN(lat2) || isNaN(lon2)) return null

    return new google.maps.LatLng(lat2.toDeg(), lon2.toDeg())
  }

  map = new google.maps.Map(document.getElementById('map'), {
    center: {
      lat: centerLat,
      lng: centerLng
    },
    zoom: 16,
    fullscreenControl: true,
    streetViewControl: false,
    mapTypeControl: false,
    mapTypeControlOptions: {
      style: google.maps.MapTypeControlStyle.DROPDOWN_MENU,
      position: google.maps.ControlPosition.RIGHT_TOP,
      mapTypeIds: [
        google.maps.MapTypeId.ROADMAP,
        google.maps.MapTypeId.SATELLITE
      ]
    }
  })

  var drawingManager = new google.maps.drawing.DrawingManager({
    drawingMode: google.maps.drawing.OverlayType.POLYGON,
    drawingControl: true,
    drawingControlOptions: {
      position: google.maps.ControlPosition.TOP_CENTER,
      drawingModes: ['polygon']
    },
    polygonOptions: {
      editable: true,
      zIndex: 100
    }
  })
  drawingManager.setMap(map);

  // hook on poly created (complete) events to instrument them
  google.maps.event.addListener(drawingManager, 'polygoncomplete', function (poly) {
    // track the number of polys
    gPolygonId++
    // give it some properties and circle tracking
    poly.id = gPolygonId
    poly.circles = []
    // track it globally
    polygons[gPolygonId] = poly

    // a path can't refer to it's parent poly (as far as I know) so I'm keeping
    // this array around and making it self referential for redraws
    var redraw = (function (id) {
      return function () {
        coverPath(polygons[id])
        refreshOutput()
      }
    }(gPolygonId))

    poly.getPaths().forEach(function (path) {
      google.maps.event.addListener(path, 'insert_at', redraw);
      google.maps.event.addListener(path, 'remove_at', redraw);
      google.maps.event.addListener(path, 'set_at', redraw);
    });

    // do the first draw
    redraw()
  })
}

function coverPath (poly) {
  // clear any old circles
  $.each(poly.circles, function (index, value) {
    value.setMap(null)
  })
  poly.circles = []

  // find our min/max lat/lng
  var lats = []
  var lngs = []
  poly.getPaths().forEach(function (path) {
    for (var i = 0; i < path.getLength(); i++) {
      var xy = path.getAt(i)
      lats.push(xy.lat())
      lngs.push(xy.lng())
    }
  })

  // // debug'ish -- draw a bounding rect
  // new google.maps.Rectangle({
  //   strokeColor: '#FF0000',
  //   strokeOpacity: 0.3,
  //   strokeWeight: 2,
  //   fillColor: '#FF0000',
  //   fillOpacity: 0.05,
  //   map: map,
  //   bounds: {
  //     north: lats.max(),
  //     south: lats.min(),
  //     east: lngs.max(),
  //     west: lngs.min()
  //   },
  //   zIndex: 1
  // });

  // cover it in circles
  var curLat = lats.min();
  var curLng = lngs.min();
  var maxPoint = new google.maps.LatLng(lats.max(), lngs.max());
  var radiusInKm = 140 / 1000;
  var onePointFurther = maxPoint.destinationPoint(90, radiusInKm / 2).destinationPoint(0, radiusInKm / 2);

  // var toomany = 100;

  while (curLng < onePointFurther.lng()) {
    // if (toomany <= 0) break
    while (curLat < onePointFurther.lat()) {
      // if (toomany-- <= 0) break
      var pointA = new google.maps.LatLng(curLat, curLng);
      var pointB = pointA.destinationPoint(90, radiusInKm * 1.732 / 4).destinationPoint(0, radiusInKm * 3 / 4);
      circIfIn(pointA, poly)
      circIfIn(pointB, poly)
      var nextPoint = pointA.destinationPoint(0, radiusInKm * 3 / 2);
      curLat = nextPoint.lat();
    }
    curLat = lats.min();
    var pointNext = new google.maps.LatLng(curLat, curLng);
    curLng = pointNext.destinationPoint(90, radiusInKm * 1.732 / 2).lng();
  }
}

function circIfIn (point, poly) {
  if (google.maps.geometry.poly.containsLocation(point, poly)) {
    // main point directly in poly, cool, do it
    poly.circles.push(drawScanCircle(point, '#00ff00'))
    return
  } else {
    // The center point isn't in the poly -- but is one of the edges?
    var edgeDetection = 1; // this could be any value of 360/n, but 1 is pretty damn accurate and not tooo slow
    for (var radial = 0; radial <= 360; radial += edgeDetection) {
      var detectionPoint = point.destinationPoint(radial, 0.07); // todo: fix hardcoded 70m
      if (google.maps.geometry.poly.containsLocation(detectionPoint, poly)) {
        // edge point directly in poly, cool, do it
        poly.circles.push(drawScanCircle(point, '#0000ff'))
        return
      }
    }
  }
  // map nothing (or a "dummy" scan zone)
  return null
  // return drawScanCircle(point, '#ff0000')
}

function drawScanCircle (point, color) {
  return new google.maps.Circle({
    strokeColor: color,
    strokeOpacity: 0.8,
    strokeWeight: 1,
    fillColor: color,
    fillOpacity: 0.35,
    map: map,
    center: point,
    radius: 70,
    zIndex: 1
  })
}

/*eslint no-extend-native: ["error", { "exceptions": ["Array", "Number"] }]*/
Array.prototype.max = function () {
  return Math.max.apply(null, this)
}

Array.prototype.min = function () {
  return Math.min.apply(null, this)
}

Number.prototype.toRad = function () {
  return this * Math.PI / 180
}

Number.prototype.toDeg = function () {
  return this * 180 / Math.PI
}
