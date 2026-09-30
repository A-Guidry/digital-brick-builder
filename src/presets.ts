import { ShapeSpec } from './shapes';

export interface Preset { id: string; blurb: string; spec: ShapeSpec }

export const PRESETS: Preset[] = [
  { id: 'house', blurb: 'Cottage with a red roof', spec: {
    name: 'Little house', mirror_x: true, shapes: [
      { type: 'box', color: 'light_gray', center: [0, 0.6, 0], size: [12, 1.2, 10] },
      { type: 'box', color: 'white', center: [0, 3.6, 0], size: [10, 4.8, 8] },
      { type: 'box', op: 'subtract', center: [0, 3.6, 0], size: [8, 4.8, 6] },
      { type: 'box', op: 'subtract', center: [0, 2.4, 4], size: [2, 2.4, 2] },
      { type: 'box', color: 'reddish_brown', center: [0, 2.4, 3.6], size: [2, 2.4, 0.8] },
      { type: 'box', op: 'subtract', center: [3, 3.6, 4], size: [1.6, 1.2, 2] },
      { type: 'box', op: 'subtract', center: [5, 3.6, 0], size: [2, 1.2, 2] },
      { type: 'wedge', color: 'red', center: [3, 7.5, 0], size: [6, 3, 11], slope: '+x' },
    ] } },
  { id: 'tree', blurb: 'Round tree on a green base', spec: {
    name: 'Tree', shapes: [
      { type: 'cylinder', color: 'green', center: [0, 0.4, 0], radius: 5, length: 0.8 },
      { type: 'cylinder', color: 'reddish_brown', center: [0, 3.2, 0], radius: 1.4, length: 5 },
      { type: 'sphere', color: 'dark_green', center: [0, 8, 0], size: [10, 8, 10] },
      { type: 'sphere', color: 'green', center: [0, 9.6, 0], size: [7, 5, 7] },
      { type: 'sphere', color: 'red', center: [3.2, 8, 2.6], size: [1.4, 1.4, 1.4] },
      { type: 'sphere', color: 'red', center: [-2.6, 7.4, 3.4], size: [1.4, 1.4, 1.4] },
    ] } },
  { id: 'car', blurb: 'Chunky red car', spec: {
    name: 'Car', mirror_x: true, shapes: [
      { type: 'cylinder', color: 'black', center: [3, 1.2, 4.6], radius: 1.3, length: 1.6, axis: 'x' },
      { type: 'cylinder', color: 'black', center: [3, 1.2, -4.6], radius: 1.3, length: 1.6, axis: 'x' },
      { type: 'box', color: 'red', center: [0, 2.4, 0], size: [6, 2.4, 14] },
      { type: 'box', color: 'red', center: [0, 4.4, -1], size: [5, 1.8, 6] },
      { type: 'box', color: 'medium_azure', center: [0, 4.4, -1], size: [5.2, 1.0, 4.8], op: 'paint' },
      { type: 'box', color: 'yellow', center: [2.2, 2.6, 7], size: [1.2, 0.8, 0.6] },
      { type: 'box', color: 'dark_gray', center: [0, 1.4, 0], size: [4, 0.8, 13.6], op: 'paint' },
    ] } },
  { id: 'rocket', blurb: 'Rocket with fins and a nose cone', spec: {
    name: 'Rocket', shapes: [
      { type: 'cylinder', color: 'white', center: [0, 5.5, 0], radius: 2.6, length: 11 },
      { type: 'cone', color: 'red', center: [0, 11, 0], radius: 2.6, length: 5 },
      { type: 'cylinder', color: 'medium_azure', center: [0, 7, 0], radius: 1.2, length: 5.4, axis: 'z' },
      { type: 'box', color: 'red', center: [0, 2.4, 0], size: [10, 1.2, 1.6] },
      { type: 'box', color: 'red', center: [0, 2.4, 0], size: [1.6, 1.2, 10] },
      { type: 'box', color: 'red', center: [0, 3.6, 0], size: [8, 1.2, 1.6] },
      { type: 'box', color: 'red', center: [0, 3.6, 0], size: [1.6, 1.2, 8] },
      { type: 'cylinder', color: 'dark_gray', center: [0, 0.6, 0], radius: 2, length: 1.2 },
    ] } },
  { id: 'heart', blurb: 'Chunky pixel heart', spec: {
    name: 'Heart', mirror_x: true, shapes: [
      { type: 'cylinder', color: 'red', center: [3.1, 1.2, 3], radius: 3.4, length: 2.4 },
      { type: 'box', color: 'red', center: [0, 1.2, 1.2], size: [12.4, 2.4, 4.4] },
      { type: 'box', color: 'red', center: [0, 1.2, -1.6], size: [10, 2.4, 2.4] },
      { type: 'box', color: 'red', center: [0, 1.2, -3.6], size: [7, 2.4, 2] },
      { type: 'box', color: 'red', center: [0, 1.2, -5.4], size: [4, 2.4, 2] },
      { type: 'box', color: 'red', center: [0, 1.2, -6.9], size: [2, 2.4, 1.6] },
      { type: 'box', color: 'white', center: [-3.4, 2.2, 3.6], size: [1.4, 0.8, 1.4], op: 'paint' },
    ] } },
  { id: 'robot', blurb: 'Boxy robot buddy', spec: {
    name: 'Robot', mirror_x: true, shapes: [
      { type: 'box', color: 'dark_gray', center: [2, 1.8, 0], size: [3, 3.6, 4] },
      { type: 'box', color: 'light_gray', center: [0, 6, 0], size: [8, 5.6, 5] },
      { type: 'box', color: 'light_gray', center: [0, 8.2, 0], size: [12, 1.2, 5] },
      { type: 'box', color: 'dark_gray', center: [5, 5.4, 0], size: [2, 4.4, 2.4] },
      { type: 'box', color: 'red', center: [0, 5.6, 2.6], size: [3.6, 1.6, 0.6] },
      { type: 'box', color: 'light_gray', center: [0, 10.6, 0], size: [6, 3.6, 5] },
      { type: 'box', color: 'yellow', center: [1.6, 10.9, 2.6], size: [1.4, 1.4, 0.6] },
      { type: 'box', color: 'dark_gray', center: [0, 13.2, 0], size: [1.4, 1.4, 1.4] },
      { type: 'sphere', color: 'red', center: [0, 14.2, 0], size: [2.4, 2.4, 2.4] },
    ] } },
  { id: 'dog', blurb: 'Brown dog', spec: {
    name: 'Dog', mirror_x: true, shapes: [
      { type: 'box', color: 'nougat', center: [1.6, 1.8, 3.6], size: [1.8, 3.6, 1.8] },
      { type: 'box', color: 'nougat', center: [1.6, 1.8, -3.6], size: [1.8, 3.6, 1.8] },
      { type: 'box', color: 'nougat', center: [0, 4.2, 0], size: [5, 3, 10] },
      { type: 'box', color: 'nougat', center: [0, 6.2, 5.2], size: [4, 3.6, 4] },
      { type: 'box', color: 'light_nougat', center: [0, 5.4, 7.4], size: [2.2, 1.6, 1.6] },
      { type: 'box', color: 'black', center: [0, 6, 8.4], size: [1, 1, 0.5] },
      { type: 'box', color: 'reddish_brown', center: [2.2, 6.2, 4.6], size: [0.8, 2.4, 1.6] },
      { type: 'box', color: 'black', center: [1, 7.2, 7.1], size: [0.8, 0.8, 0.6] },
      { type: 'box', color: 'nougat', center: [0, 5.6, -5.4], size: [1.2, 2.4, 1.6] },
    ] } },
  { id: 'castle', blurb: 'Castle tower with battlements', spec: {
    name: 'Castle tower', shapes: [
      { type: 'cylinder', color: 'dark_gray', center: [0, 0.6, 0], radius: 6.5, length: 1.2 },
      { type: 'cylinder', color: 'light_gray', center: [0, 6.6, 0], radius: 5, length: 10.8 },
      { type: 'cylinder', color: 'dark_gray', center: [0, 12.6, 0], radius: 6, length: 1.2 },
      { type: 'box', color: 'dark_gray', center: [0, 14.1, 5.4], size: [1.6, 1.8, 1.4] },
      { type: 'box', color: 'dark_gray', center: [0, 14.1, -5.4], size: [1.6, 1.8, 1.4] },
      { type: 'box', color: 'dark_gray', center: [5.4, 14.1, 0], size: [1.4, 1.8, 1.6] },
      { type: 'box', color: 'dark_gray', center: [-5.4, 14.1, 0], size: [1.4, 1.8, 1.6] },
      { type: 'box', op: 'subtract', center: [0, 2.6, 5], size: [2, 2.4, 3] },
      { type: 'box', color: 'reddish_brown', center: [0, 2.4, 4.6], size: [2, 2.4, 0.8] },
      { type: 'box', op: 'subtract', center: [0, 8, 5], size: [1, 2, 3] },
      { type: 'cone', color: 'red', center: [0, 13.2, 0], radius: 4, length: 4.5 },
    ] } },
  { id: 'snowman', blurb: 'Snowman with hat and scarf', spec: {
    name: 'Snowman', mirror_x: true, shapes: [
      { type: 'cylinder', color: 'white', center: [0, 0.4, 0], radius: 5.5, length: 0.8 },
      { type: 'sphere', color: 'white', center: [0, 3.8, 0], size: [9, 6.4, 9] },
      { type: 'sphere', color: 'white', center: [0, 8.4, 0], size: [6.4, 5, 6.4] },
      { type: 'sphere', color: 'white', center: [0, 12, 0], size: [4.6, 4, 4.6] },
      { type: 'cylinder', color: 'red', center: [0, 10.2, 0], radius: 2.9, length: 1.2 },
      { type: 'box', color: 'red', center: [1.5, 8.6, 3], size: [2, 3.6, 1.2] },
      { type: 'box', color: 'orange', center: [0.5, 12, 3], size: [1, 1, 2.6] },
      { type: 'box', color: 'black', center: [1.5, 13, 2], size: [1, 1, 1.4], op: 'paint' },
      { type: 'box', color: 'black', center: [1.5, 8, 3.4], size: [1, 1, 1.4], op: 'paint' },
      { type: 'box', color: 'black', center: [1.5, 5.6, 4], size: [1, 1, 1.4], op: 'paint' },
      { type: 'cylinder', color: 'black', center: [0, 14.2, 0], radius: 3, length: 0.8 },
      { type: 'cylinder', color: 'black', center: [0, 16, 0], radius: 2, length: 3 },
      { type: 'box', color: 'red', center: [0, 15, 0], size: [4.2, 0.8, 4.2], op: 'paint' },
    ] } },
  { id: 'penguin', blurb: 'Waddling penguin', spec: {
    name: 'Penguin', mirror_x: true, shapes: [
      { type: 'sphere', color: 'black', center: [0, 5.4, 0], size: [8, 10, 6] },
      { type: 'sphere', color: 'white', center: [0, 4.6, 1.6], size: [5, 7, 4], op: 'paint' },
      { type: 'sphere', color: 'black', center: [0, 11, 0], size: [6, 5, 5] },
      { type: 'box', color: 'orange', center: [0, 10.4, 3], size: [2, 1, 2.2] },
      { type: 'box', color: 'white', center: [1.5, 11.6, 2], size: [1, 1, 1], op: 'paint' },
      { type: 'box', color: 'orange', center: [2, 0.6, 2], size: [2, 1.2, 4] },
      { type: 'box', color: 'black', center: [4.4, 6.4, 0], size: [1.6, 4.4, 2.6] },
    ] } },
  { id: 'mushroom', blurb: 'Red toadstool with spots', spec: {
    name: 'Mushroom', shapes: [
      { type: 'sphere', color: 'red', center: [0, 5.6, 0], size: [12, 8, 12] },
      { type: 'box', op: 'subtract', center: [0, 2.2, 0], size: [14, 5.6, 14] },
      { type: 'cylinder', color: 'green', center: [0, 0.4, 0], radius: 6, length: 0.8 },
      { type: 'cylinder', color: 'light_nougat', center: [0, 3.2, 0], radius: 2.2, length: 5.2 },
      { type: 'sphere', color: 'white', center: [-2.5, 9, 1], size: [2.6, 1.6, 2.6], op: 'paint' },
      { type: 'sphere', color: 'white', center: [2.5, 8.6, 2.5], size: [2.6, 2.6, 2.6], op: 'paint' },
      { type: 'sphere', color: 'white', center: [1, 9.4, -2.5], size: [2.6, 1.6, 2.6], op: 'paint' },
      { type: 'sphere', color: 'white', center: [-4.5, 7, -2], size: [2, 2.4, 2.4], op: 'paint' },
    ] } },
  { id: 'lighthouse', blurb: 'Striped lighthouse tower', spec: {
    name: 'Lighthouse', shapes: [
      { type: 'cylinder', color: 'dark_gray', center: [0, 0.6, 0], radius: 5.5, length: 1.2 },
      { type: 'cylinder', color: 'white', center: [0, 3, 0], radius: 3.8, length: 3.6 },
      { type: 'cylinder', color: 'red', center: [0, 6.6, 0], radius: 3.4, length: 3.6 },
      { type: 'cylinder', color: 'white', center: [0, 10.2, 0], radius: 3, length: 3.6 },
      { type: 'cylinder', color: 'red', center: [0, 13.8, 0], radius: 2.6, length: 3.6 },
      { type: 'cylinder', color: 'dark_gray', center: [0, 15.6, 0], radius: 3.6, length: 0.8 },
      { type: 'cylinder', color: 'yellow', center: [0, 17.2, 0], radius: 2, length: 2.4 },
      { type: 'cone', color: 'red', center: [0, 18.4, 0], radius: 2.3, length: 3 },
      { type: 'box', color: 'reddish_brown', center: [0, 3, 3.6], size: [2, 2.4, 1.6], op: 'paint' },
    ] } },
  { id: 'sailboat', blurb: 'Sailboat on the water', spec: {
    name: 'Sailboat', shapes: [
      { type: 'box', color: 'medium_azure', center: [0, 0.4, 0], size: [12, 0.8, 22] },
      { type: 'box', color: 'blue', center: [0, 2, -1], size: [6, 2.4, 12] },
      { type: 'wedge', color: 'blue', center: [0, 2, 6.5], size: [6, 2.4, 3], slope: '+z' },
      { type: 'box', color: 'white', center: [0, 2.4, -1], size: [6.2, 0.8, 12.2], op: 'paint' },
      { type: 'box', color: 'reddish_brown', center: [0.5, 9.7, -0.5], size: [1, 13, 1] },
      { type: 'wedge', color: 'white', center: [0.5, 8.7, -4], size: [1, 11, 6], slope: '-z' },
      { type: 'wedge', color: 'white', center: [0.5, 8.2, 2], size: [1, 9, 4], slope: '+z' },
      { type: 'box', color: 'red', center: [0.5, 15.4, 0.5], size: [1, 1.6, 3] },
    ] } },
  { id: 'cat', blurb: 'Sitting orange cat', spec: {
    name: 'Cat', mirror_x: true, shapes: [
      { type: 'box', color: 'orange', center: [0, 2.6, -1], size: [6, 5.2, 6] },
      { type: 'box', color: 'white', center: [0, 2.4, 2.4], size: [2, 3.6, 1], op: 'paint' },
      { type: 'box', color: 'white', center: [2, 0.6, 2], size: [2, 1.2, 2] },
      { type: 'sphere', color: 'orange', center: [0, 7.2, 1], size: [7, 5.6, 5.6] },
      { type: 'cone', color: 'orange', center: [2.5, 9.4, 1], radius: 1.6, length: 3 },
      { type: 'box', color: 'green', center: [1.5, 7.8, 3.4], size: [1, 1, 1], op: 'paint' },
      { type: 'box', color: 'bright_pink', center: [0, 6.8, 3.6], size: [2, 0.8, 1], op: 'paint' },
    ] } },
  { id: 'duck', blurb: 'Yellow duck on the pond', spec: {
    name: 'Duck', mirror_x: true, shapes: [
      { type: 'box', color: 'medium_azure', center: [0, 0.4, 0], size: [12, 0.8, 14] },
      { type: 'sphere', color: 'yellow', center: [0, 3.6, -0.5], size: [8, 6, 10] },
      { type: 'wedge', color: 'yellow', center: [0, 5.6, -5.5], size: [4, 2.4, 3], slope: '-z' },
      { type: 'sphere', color: 'yellow', center: [0, 8, 3], size: [5, 5, 5] },
      { type: 'box', color: 'orange', center: [0, 7.6, 5.6], size: [2, 1, 2.2] },
      { type: 'box', color: 'black', center: [1.5, 8.8, 4.6], size: [1, 1, 1], op: 'paint' },
      { type: 'sphere', color: 'orange', center: [3.6, 4, -1], size: [1.6, 3, 5], op: 'paint' },
    ] } },
  { id: 'pyramid', blurb: 'Stepped desert pyramid', spec: {
    name: 'Pyramid', shapes: [
      { type: 'box', color: 'tan', center: [0, 0.6, 0], size: [16, 1.2, 16] },
      { type: 'box', color: 'dark_tan', center: [0, 1.8, 0], size: [14, 1.2, 14] },
      { type: 'box', color: 'tan', center: [0, 3, 0], size: [12, 1.2, 12] },
      { type: 'box', color: 'dark_tan', center: [0, 4.2, 0], size: [10, 1.2, 10] },
      { type: 'box', color: 'tan', center: [0, 5.4, 0], size: [8, 1.2, 8] },
      { type: 'box', color: 'dark_tan', center: [0, 6.6, 0], size: [6, 1.2, 6] },
      { type: 'box', color: 'tan', center: [0, 7.8, 0], size: [4, 1.2, 4] },
      { type: 'box', color: 'yellow', center: [0, 9, 0], size: [2, 1.2, 2] },
      { type: 'box', op: 'subtract', center: [0, 0.6, 7.2], size: [2, 1.2, 2] },
      { type: 'box', color: 'black', center: [0, 0.6, 5.4], size: [2, 1.2, 1.6], op: 'paint' },
    ] } },
  { id: 'flower', blurb: 'Flower in an orange pot', spec: {
    name: 'Flower', mirror_x: true, shapes: [
      { type: 'cylinder', color: 'orange', center: [0, 1.6, 0], radius: 3, length: 3.2 },
      { type: 'cylinder', color: 'orange', center: [0, 3.8, 0], radius: 3.6, length: 1.2 },
      { type: 'cylinder', color: 'dark_green', center: [0, 4.6, 0], radius: 1, length: 12 },
      { type: 'box', color: 'green', center: [2, 8, 0], size: [4, 1.2, 2] },
      { type: 'box', color: 'green', center: [3, 9.2, 0], size: [2, 1.2, 2] },
      { type: 'cylinder', color: 'bright_pink', center: [3, 15, 0], radius: 2.2, length: 2, axis: 'z' },
      { type: 'cylinder', color: 'bright_pink', center: [0, 18, 0], radius: 2.2, length: 2, axis: 'z' },
      { type: 'cylinder', color: 'bright_pink', center: [0, 12, 0], radius: 2.2, length: 2, axis: 'z' },
      { type: 'cylinder', color: 'yellow', center: [0, 15, 0.4], radius: 2.2, length: 2.8, axis: 'z' },
    ] } },
  { id: 'firetruck', blurb: 'Red fire truck with ladder', spec: {
    name: 'Fire truck', mirror_x: true, shapes: [
      { type: 'cylinder', color: 'black', center: [3, 1.2, 6.2], radius: 1.3, length: 1.6, axis: 'x' },
      { type: 'cylinder', color: 'black', center: [3, 1.2, -5.4], radius: 1.3, length: 1.6, axis: 'x' },
      { type: 'box', color: 'red', center: [0, 2.4, -1], size: [6, 2.4, 16] },
      { type: 'box', color: 'red', center: [0, 4.8, 5.5], size: [6, 2.4, 5] },
      { type: 'box', color: 'medium_azure', center: [0, 5, 6.4], size: [6.2, 1.2, 3], op: 'paint' },
      { type: 'box', color: 'white', center: [0, 2.4, -1], size: [6.2, 0.8, 16.2], op: 'paint' },
      { type: 'box', color: 'dark_gray', center: [0, 1.6, 8], size: [6, 0.8, 2] },
      { type: 'box', color: 'yellow', center: [0, 4.2, -3], size: [4, 1.2, 10] },
      { type: 'box', color: 'light_gray', center: [1.5, 5.2, -3], size: [1, 0.8, 10] },
      { type: 'box', color: 'blue', center: [0, 6.4, 5.5], size: [4, 0.8, 2] },
    ] } },
];
