import { AfterViewInit, Component, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import * as mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { PORTS } from '../../constants/constants';
import { MapService } from '../../services/map/map.service';
import { PortDetailsComponent } from '../port-details/port-details.component';
import { WeatherDetailsComponent } from '../weather-details/weather-details.component';
import { debounceTime, Subject, switchMap } from 'rxjs';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-port-map',
  standalone: false,
  templateUrl: './port-map.component.html',
  styleUrls: ['./port-map.component.scss']
})
export class PortMapComponent implements OnInit, AfterViewInit {
  private map: mapboxgl.Map | undefined;
  public searchQuery: string = '';
  searchSubject: Subject<string> = new Subject();
  ports = PORTS;
  selectedPort: any;
  private savedView: { center: mapboxgl.LngLat, zoom: number } | null = null;
  private weatherLayer: mapboxgl.Layer | undefined; // Change from `null` to `undefined`
  selectedWeatherType: string = 'wind'; // Default weather layer

  constructor(
    private mapService: MapService,
    private dialog: MatDialog
  ) { }

  ngOnInit(): void {
    this.setupSearch();
  }

  ngAfterViewInit(): void {
    this.initMap();
    this.addClusteredPortMarkers(this.ports);
  }
  

  private initMap(): void {
    this.map = new mapboxgl.Map({
      container: 'map',
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [0, 20],
      zoom: 3,
      accessToken: environment.mapbox.accessToken
    });

    this.map.on('load', () => {
      this.addClusteredPortMarkers(this.ports);
    });
  }

  private addClusteredPortMarkers(ports: any[]): void {
    if (!this.map) return;

    const geojson: GeoJSON.FeatureCollection<GeoJSON.Point> = {
      type: 'FeatureCollection',
      features: ports.map(port => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [port.lng, port.lat]
        },
        properties: {
          title: port.name,
          description: port.description
        }
      }))
    };

    this.map.addSource('ports', {
      type: 'geojson',
      data: geojson,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50
    });

    this.map.addLayer({
      id: 'clusters',
      type: 'circle',
      source: 'ports',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step',
          ['get', 'point_count'],
          '#51bbd6',
          100,
          '#f1f075',
          750,
          '#f28cb1'
        ],
        'circle-radius': [
          'step',
          ['get', 'point_count'],
          20,
          100,
          30,
          750,
          40
        ]
      }
    });

    this.map.addLayer({
      id: 'cluster-count',
      type: 'symbol',
      source: 'ports',
      filter: ['has', 'point_count'],
      layout: {
        'text-field': '{point_count_abbreviated}',
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12
      }
    });

    this.map.addLayer({
      id: 'unclustered-point',
      type: 'circle',
      source: 'ports',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': '#11b4da',
        'circle-radius': 4,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#fff'
      }
    });

    this.map.on('click', 'clusters', (e) => {
      const features = this.map!.queryRenderedFeatures(e.point, {
        layers: ['clusters']
      });
      const clusterId = features[0].properties!['cluster_id'];
      const source = this.map!.getSource('ports') as mapboxgl.GeoJSONSource;
      source.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;

        this.map!.easeTo({
          center: (features[0].geometry as any).coordinates,
          zoom: zoom || this.map!.getZoom() // Fallback to current zoom if zoom is null
        });
      });
    });

    this.map.on('click', 'unclustered-point', (e) => {
      const coordinates = (e.features![0].geometry as any).coordinates.slice();
      const description = e.features![0].properties!['description'];

      while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
      }

      new mapboxgl.Popup()
        .setLngLat(coordinates)
        .setHTML(description)
        .addTo(this.map!);
    });

    this.map.on('mouseenter', 'clusters', () => {
      this.map!.getCanvas().style.cursor = 'pointer';
    });

    this.map.on('mouseleave', 'clusters', () => {
      this.map!.getCanvas().style.cursor = '';
    });
  }

  setupSearch() {
    // Search debounce setup
    this.searchSubject.pipe(
      debounceTime(2000),  // 2000ms after typing stops
      switchMap((searchTerm) => this.mapService.searchPorts(searchTerm))  // Call service to search ports
    ).subscribe((port) => {
      if (port) {
        this.focusOnPort(port);  // Focus map on port
      }
    });
  }

  onSearch(event: any) {
    const searchTerm = event.target.value;
    this.searchSubject.next(searchTerm);  // Trigger search when typing
  }

  focusOnPort(port: any) {
    // Ensure port is found and handle zooming animation
    const lat = port.lat;
    const lon = port.lng;
    const zoomLevel = 12;  // Adjust zoom level as necessary

    if (this.map) {
      this.map.flyTo({
        center: [lon, lat],
        zoom: zoomLevel,
        essential: true
      });
      this.selectedPort = port;

      // Ensure popup is open (handle undefined port)
      if (port && port.popup) {
        new mapboxgl.Popup()
          .setLngLat([lon, lat])
          .setHTML(port.popup)
          .addTo(this.map);
      }
    }
  }

  saveBookmark(): void {
    const center = this.map!.getCenter();
    const zoom = this.map!.getZoom();

    const bookmark = { center, zoom };
    localStorage.setItem('savedView', JSON.stringify(bookmark));
  }

  loadBookmark(): void {
    const savedView = localStorage.getItem('savedView');
    if (!savedView) {
      alert('No saved view to load.');
      return;
    }

    const { center, zoom } = JSON.parse(savedView);

    // Smooth animation to the saved center and zoom level
    this.map!.flyTo({
      center: center,
      zoom: zoom,
      essential: true
    });
  }

  toggleWeatherLayer(): void {
    if (this.weatherLayer) {
      this.map!.removeLayer(this.weatherLayer.id);
      this.weatherLayer = undefined;
    } else {
      this.addWeatherLayer(this.selectedWeatherType);
    }
  }

  onWeatherLayerChange(event: any): void {
    if (this.weatherLayer) {
      this.map!.removeLayer(this.weatherLayer.id);
    }
    this.addWeatherLayer(event.value);
  }

  private addWeatherLayer(type: string): void {
    const layerUrls: { [key: string]: string } = {
      wind: `https://tile.openweathermap.org/map/wind_new/{z}/{x}/{y}.png?appid=${environment.WEATHER_API}`,
      rain: `https://tile.openweathermap.org/map/precipitation_new/{z}/{x}/{y}.png?appid=${environment.WEATHER_API}`,
      storm: `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${environment.WEATHER_API}`,
      clouds: `https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?appid=${environment.WEATHER_API}`,
      temperature: `https://tile.openweathermap.org/map/temp_new/{z}/{x}/{y}.png?appid=${environment.WEATHER_API}`,
      pressure: `https://tile.openweathermap.org/map/pressure_new/{z}/{x}/{y}.png?appid=${environment.WEATHER_API}`
    };

    const layerUrl = layerUrls[type];

    // Add the source
    this.map!.addSource('weather-source', {
      type: 'raster',
      tiles: [layerUrl],
      tileSize: 256
    });

    // Add the layer
    this.weatherLayer = {
      id: 'weather-layer',
      type: 'raster',
      source: 'weather-source', // Reference the source ID
      paint: {}
    };

    this.map!.addLayer(this.weatherLayer);
  }

  private fetchWeatherForRoute(routeCoordinates: any[]): void {
    const weatherData: any[] = [];

    const fetchWeatherData = (lat: number, lon: number) => {
      const weatherApiUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${environment.WEATHER_API}`;

      return fetch(weatherApiUrl)
        .then((response) => response.json())
        .then((data) => ({
          temperature: data.main.temp,
          windSpeed: data.wind.speed,
          rain: data.rain ? data.rain['1h'] : '0',
        }))
        .catch((error) => {
          console.error('Error fetching weather data:', error);
          return null;
        });
    };

    Promise.all(routeCoordinates.map((point) => fetchWeatherData(point.lat, point.lng)))
      .then((results) => {
        results.forEach((data, index) => {
          if (data) {
            weatherData.push({
              name: routeCoordinates[index].name,
              ...data,
            });
          }
        });

        if (weatherData.length > 0) {
          this.openWeatherDialog(weatherData);
        }
      })
      .catch((error) => {
        console.error('Error fetching weather data for route:', error);
      });
  }

  private openWeatherDialog(weatherData: any): void {
    this.dialog.open(WeatherDetailsComponent, {
      width: '400px',
      data: weatherData,
    });
  }
}
