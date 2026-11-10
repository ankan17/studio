// Format presets offered when creating a project. Frame rate is chosen separately (24, 25, 30, 60).
export const FORMAT_PRESETS = [
  {id: "landscape", label: "Landscape 16:9", width: 1920, height: 1080},
  {id: "vertical", label: "Vertical 9:16", width: 1080, height: 1920},
  {id: "portrait", label: "Portrait 4:5", width: 1080, height: 1350},
  {id: "square", label: "Square 1:1", width: 1080, height: 1080},
] as const;
