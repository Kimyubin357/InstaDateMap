/** CSS screen sizes and pixel ratios for portrait iPhone launch screens. */
export const appleStartupSizes = [
  [320, 568, 2], [375, 667, 2], [414, 736, 3],
  [375, 812, 3], [414, 896, 2], [414, 896, 3],
  [390, 844, 3], [393, 852, 3], [428, 926, 3],
  [430, 932, 3], [402, 874, 3], [440, 956, 3],
] as const;

export const appleStartupImages = appleStartupSizes.map(([width, height, ratio]) => ({
  url: `/splash/ios-${width * ratio}x${height * ratio}.png`,
  media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`,
}));
