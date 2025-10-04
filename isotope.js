var BOXNAME = '.member_fc';
var INPUT = '.input_filters';
var GROUP = '.group_filters';
var NAME = '.a_name_fc';
var tagged = "tagged_fc";

/*
    <x class="group_filters" groupName="name1">
        <input type="checkbox" class="input_filters" filterName="*">
        <input type="checkbox" class="input_filters" filterName=".a1">
        <input type="checkbox" class="input_filters" filterName=".a2">
        <input type="checkbox" class="input_filters" filterName=".a3">
    </x>

    <x class="group_filters" groupName="name2">
        <input type="checkbox" class="input_filters" filterName="*">
        <input type="checkbox" class="input_filters" filterName=".b1">
        <input type="checkbox" class="input_filters" filterName=".b2">
        <input type="checkbox" class="input_filters" filterName=".b3">
    </x>
*/

$(function() {

    ///////// SET AVATARS LIST
    inputbox();
    setFilters();

    //debugRandomFilters();
});

/*
    search function
*/
function inputbox() {
    var ths = $('#INPUTBOX');

    // binds event and triggers search when "enter" is pressed
    ths.on('keyup', function(event) {
        if (event.keyCode === 13) {
            // Cancel the default action, if needed
            event.preventDefault();

            // takes & verifies if name matches
            var name = tagName(ths.val());
            var verifiedName = verifyNameExists(name);

            // changes #url if needed
            if (!$(BOXNAME + '[nm="' + verifiedName + '"]').hasClass('hidden')) {
                if (verifiedName != false) {
                    window.location.hash = '#' + verifiedName.replace( /\s/gi, '-');
                    var tagged = $(NAME + '[name="' + verifiedName + '"]').closest(BOXNAME);
                }
            }
        }
    });
}

/*
    SUBGLOBAL function : return normalized name
*/
function tagName(name) {
    return name
        .trim()
        .toLowerCase()
        .replace( /\s/gi, '-')
        .replace( /[^\w-]+/gi, '')
        .replace( /(^-+)|(-+$)/gi, '')
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
    ;
}

/*
    SUBGLOBAL function : verify name is on page
        - takes the closest match
        - if no match, returns false
*/
function verifyNameExists(name) {
    if (name == '') return false;
    var exists = $(NAME + '[name*="' + name + '"]');
    if (exists.length == 0) return false;
    else return $(exists[0]).attr('name');
}





////////// STEP 3 : PARAMS //////////

/*
    SUBGLOBAL function : return normalized name
*/
function increment(input, maxs) {
    if (input.length != maxs.length) return false;
    for (var i = 0; i < input.length; i++)
        if (input[i]>maxs[i]) return false;

    for (var i = input.length - 1; i >= 0; i--) {
        if (input[i] != (maxs[i])) {
            input[i] ++;
            return input;
        } else input[i] = 0;
    }
    // if didn't return then couldn't overflow till done
    // so it reached the max -> returns false AND
    // careful that input = [0,0,...,0]
    return false;
}


function setFilters() {
    //$('#FILTRES .trigger_options').click();

    $(GROUP).each(function() {
        var group = $(this);
        var groupName = group.attr('groupName');
        group.find(INPUT).each(function() {
            var ths = $(this);
            ths.attr('name', groupName);
            if (ths.attr('filterName') == "*") {
                ths.prop('checked', true);
                ths.click(function () {
                    starClicked(ths);
                });
            }
            else {
                ths.prop('checked', false);
                ths.click(function () {
                    nonStarClicked(ths);
                });
            }
            ths.click(function() {executeFilters();});
        });
    });
}

function starClicked(ths) {
    ths.closest(GROUP).find(INPUT).each(function() {
        if ($(this).attr('filterName') != '*')
            $(this).prop('checked', false);
    });
}

function nonStarClicked(ths) {
    ths.closest(GROUP).each(function() {
        var c = 0;
        $(this).find(INPUT).each(function() {
            if ($(this).attr('filterName') == '*')
                $(this).prop('checked', false);
            else {
                if ($(this).prop('checked')) c++;
            }
        });

        if (c == 0) $(this).find('[filterName="*"]').eq(0).prop('checked', true);
    });
}

function executeFilters() {
    var filtersList = calculateFilters();
    //log(filtersList);
    var active = renderActiveFilters(filtersList);
    //log(active);
    sortByFilters(active);
}

function calculateFilters() {
    var filters = {};
    $(GROUP).each(function() {
        var group = $(this);
        var groupName = group.attr('groupName');
        group.find(INPUT).each(function() {
            var ths = $(this);
            var filterName = ths.attr('filterName');
            if (ths.prop('checked') && filterName != "*") {
                if (!(groupName in filters))
                    filters[groupName] = [filterName];
                else
                    filters[groupName].push(filterName);
            }
        });
    });
    return filters;
}

function renderActiveFilters(dico) {
    var inp = [];       // array translation of var dico (type dic)
    var outL = [];      // list of concanated filters of each group
                        // ['.x.y.z', '.a.b.c', etc]
    var indexes = [];   // list of indexes used later on
                        // [0,0,etc]
    var lengths = [];   // max index for each el of indexes
                        // [3,6, etc] (for example)
    var separator = ',' // separator for all regexs
    var separator2= '' // separator between the filters

    //   TRANSLATES DICO INTO A LIST
    // + fills length  (dico[i].length)
    // + fills indexes (0)
    for (var list in dico) {
        if (dico[list].length > 0) {
            inp.push(dico[list]);
            lengths.push(dico[list].length - 1);
            indexes.push(0);
        }
    }

    // (1) creates empty f string
    // (2) takes one possible combination of filters (inp[i][indexes[i]])
    //     and concatenates to the f string
    // (3) push to outL, list of each combination
    // (4) increments indexes so that all combinations are listed
    if (inp.length > 1) {
        while (indexes != false) {
            var f = '';
            for (var i = 0; i < inp.length; i++) {
                f += inp[i][indexes[i]];
                if (i != inp.length - 1) f += separator2;
            }
            outL.push(f);
            indexes = increment(indexes, lengths);
        }
    } else outL = inp; // in case only one group of filters is selected

    return outL;
}

function sortByFilters(filters) {
    if (filters.length == 0)
        $(BOXNAME).removeClass('hidden');
    else {
        $(BOXNAME).addClass('hidden');
        for (active of filters) {
            $(BOXNAME + active).removeClass('hidden');
        }
    }
};





////////// STEP 0 : GLOBAL FUNCTIONS //////////

function log(s) {console.log(s);}

function sortObjectByKeys(o) {
    return Object.keys(o).sort().reduce((r, k) => (r[k] = o[k], r), {});
}

function dlength(dico) {return Object.keys(dico).length;}

function pause(milliseconds) {
	var dt = new Date();
	while ((new Date()) - dt <= milliseconds) { /* Do nothing */ }
}
