var Extension = imports.misc.extensionUtils.extensions['paperwm@hedning:matrix.org']
var Clutter = imports.gi.Clutter;
var Tweener = imports.ui.tweener;
var Lang = imports.lang;
var St = imports.gi.St;
var Pango = imports.gi.Pango;

var Tiling = Extension.imports.tiling;
var utils = Extension.imports.utils;
var debug = utils.debug;

var MINIMAP_SCALE = 0.15;

function calcOffset(metaWindow) {
    let buffer = metaWindow.get_buffer_rect();
    let frame = metaWindow.get_frame_rect();
    let x_offset = frame.x - buffer.x;
    let y_offset = frame.y - buffer.y;
    return [x_offset, y_offset];
}

var WindowCloneLayout = new Lang.Class({
    Name: 'PaperWindowCloneLayout',
    Extends: Clutter.LayoutManager,

    _init: function() {
        this.parent();
    },

    _makeBoxForWindow: function(window) {
        // We need to adjust the position of the actor because of the
        // consequences of invisible borders -- in reality, the texture
        // has an extra set of "padding" around it that we need to trim
        // down.

        // The outer rect (from which we compute the bounding box)
        // paradoxically is the smaller rectangle, containing the positions
        // of the visible frame. The input rect contains everything,
        // including the invisible border padding.
        let inputRect = window.get_buffer_rect();
        let frame = window.get_frame_rect();

        let box = new Clutter.ActorBox();

        box.set_origin(((inputRect.x - frame.x)*MINIMAP_SCALE),
                       (inputRect.y - frame.y)*MINIMAP_SCALE);
        box.set_size(inputRect.width*MINIMAP_SCALE,
                     inputRect.height*MINIMAP_SCALE);

        return box;
    },

    vfunc_get_preferred_height: function(container, forWidth) {
        let frame = container.get_first_child().meta_window.get_frame_rect();
        return [MINIMAP_SCALE*frame.height, MINIMAP_SCALE*frame.height];
    },

    vfunc_get_preferred_width: function(container, forHeight) {
        let frame = container.get_first_child().meta_window.get_frame_rect();
        return [MINIMAP_SCALE*frame.width, MINIMAP_SCALE*frame.width];
    },

    vfunc_allocate: function(container, box, flags) {
        let child = container.first_child;
        let realWindow = child.source;
        if (!realWindow)
            return;

        child.allocate(this._makeBoxForWindow(realWindow.meta_window),
                       flags);
    }
});

class Minimap {
    constructor(space) {
        this.space = space;
        let actor = new St.Widget({name: 'minimap-background',
                                    style_class: 'switcher-list'});
        this.actor = actor;
        actor.height = space.height*0.20;

        let highlight = new St.Widget({name: 'minimap-highlight',
                                       style_class: 'tile-preview'});
        this.highlight = highlight;
        let label = new St.Label();
        label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.label = label;;

        let clip = new St.Widget({name: 'container-clip'});
        this.clip = clip;
        let container = new St.Widget({name: 'minimap-container'});
        this.container = container;
        container.height = Math.round(space.height*MINIMAP_SCALE);

        actor.add_actor(highlight);
        actor.add_actor(label);
        actor.add_actor(clip);
        clip.add_actor(container);
        clip.set_position(12 + Tiling.window_gap, 15 + 10);
        highlight.y = clip.y - 10;
    }

    show() {
        this.clones = this.createClones(this.space);
        this.restack();
        this.layout(false);
    }

    createClones(windows) {
        return windows.map((mw) => {
            let windowActor = mw.get_compositor_private();
            let clone = new Clutter.Clone({ source: windowActor });
            let container = new Clutter.Actor({
                layout_manager: new WindowCloneLayout(),
                name: "window-clone-container"
            });
            clone.meta_window = mw;
            container.meta_window = mw;
            container.add_actor(clone);

            return container;
        });
    }

    layout(animate = true) {
        let actors = this.clones;
        function tweenTo(actor, x) {
            let time = 0;
            if (animate) {
                time = 0.25;
            }
            actor.destinationX = x;
            Tweener.addTween(actor, { x: actor.destinationX
                                      , y: 0
                                      , scale_x: 1
                                      , scale_y: 1
                                      , time: time
                                      , transition: "easeInOutQuad"});
        }

        function propagate_forward(i, leftEdge, gap) {
            if(i < 0 || i >= actors.length)
                return;
            let actor = actors[i];
            let w = actor.width;
            let x = leftEdge;

            tweenTo(actor, x);

            propagate_forward(i+1, Math.round(x + w + gap), gap);
        }

        propagate_forward(0, 0, Tiling.window_gap);
        this.clip.width = Math.min(this.container.width,
                                    this.space.width - this.clip.x*2);
        this.actor.width = this.clip.width + this.clip.x*2;
        this.clip.set_clip(0, 0, this.clip.width, this.clip.height);
        this.label.set_style(`max-width: ${this.clip.width}px;`);
    }

    restack() {
        this.container.remove_all_children();
        let clones = this.clones;

        for (let i=0; i < clones.length; i++) {
            this.container.add_actor(clones[i]);
        }
    }

    reorder(index, targetIndex) {
        // targetX is the destination of the moving window in viewport
        // coordinates

        let movingClone = this.clones[index];
        let next = this.clones[targetIndex];


        // Make sure the moving window is on top
        this.container.set_child_above_sibling(
            movingClone, this.container.last_child);

        let temp = this.clones[index];
        this.clones[index] = this.clones[targetIndex];
        this.clones[targetIndex] = temp;

        this.layout(false);
        this.select(targetIndex);
    }

    select(index) {
        let clip = this.clip;
        let container = this.container;
        let highlight = this.highlight;
        let label = this.label;
        let selected = this.clones[index];
        if (!selected)
            return;

        label.text = selected.meta_window.title;

        if (selected.x + selected.width + container.x > clip.width)
            container.x -= selected.width + 500;
        if (selected.x + container.x < 0)
            container.x += selected.width + 500;

        if (container.x + container.width < clip.width)
            container.x = clip.width - container.width;

        if (container.x > 0)
            container.x = 0;

        let gap = Tiling.window_gap;
        highlight.x = clip.x + container.x + Math.round(selected.destinationX)
            - Math.round(gap/2);
        highlight.set_size(selected.width + gap, clip.height + 20);

        let x = Math.round(highlight.x)
            + Math.round((highlight.width - label.width)/2);
        if (x + label.width > clip.x + clip.width)
            x = clip.x + clip.width - label.width + 5;
        if (x < 0)
            x = clip.x - 5;

        label.set_position(
            x,
            clip.y + Math.round(clip.height + 20));

        this.actor.height = this.label.y + this.label.height + 12;
    }
}
